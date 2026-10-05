import { useCallback, useEffect, useRef, useState } from 'react'

import {
  BUFFER_LIMIT,
  BUFFER_LOW,
  PhotoInbox,
  boothInviteUrl,
  createBoothCode,
  planChunks,
  type DuoMessage,
  type WireMessage,
} from '@/lib/duo-protocol'

export type DuoStatus =
  | 'off'
  /** Talking to the signaling server. */
  | 'connecting'
  /** In a room alone, waiting for the other person. */
  | 'waiting'
  /** Both present, negotiating the peer connection. */
  | 'linking'
  /** Session is up — over either transport. */
  | 'live'
  | 'error'

/**
 * How the booth session is travelling.
 * - `p2p`   direct browser-to-browser data channel, with live video.
 * - `relay` through our own signaling socket, with low-rate preview frames.
 */
export type DuoTransport = 'p2p' | 'relay'

/** Give the direct connection this long before falling back. */
const LINK_TIMEOUT_MS = 12_000
/** ~6fps stand-in for live video when relaying. */
const PREVIEW_INTERVAL_MS = 160
/** Preview frames are disposable — never let them queue behind photos. */
const PREVIEW_DROP_ABOVE = 256 * 1024

const STUN_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
]

/**
 * TURN is an optional upgrade, not a requirement: without it a blocked pair
 * simply falls back to the relay transport below. Configure it only if you want
 * full-quality live video on networks that refuse direct connections.
 */
function iceServers(): RTCIceServer[] {
  const urls = import.meta.env.VITE_TURN_URLS as string | undefined
  const username = import.meta.env.VITE_TURN_USERNAME as string | undefined
  const credential = import.meta.env.VITE_TURN_CREDENTIAL as string | undefined

  if (!urls || !username || !credential) return STUN_SERVERS

  const list = urls
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean)

  return list.length ? [...STUN_SERVERS, { urls: list, username, credential }] : STUN_SERVERS
}

export const hasTurn = () => Boolean(import.meta.env.VITE_TURN_URLS)

function signalUrl() {
  const configured = import.meta.env.VITE_SIGNAL_URL as string | undefined
  if (configured) return configured
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/rtc`
}

interface UseDuoOptions {
  /** The local camera feed, shared with the peer once connected. */
  localStream: MediaStream | null
  /** Small JPEG grab of the local camera, used for relay previews. */
  snapshot?: () => string | null
  onMessage: (message: DuoMessage) => void
  onNotice: (text: string) => void
}

export function useDuo({ localStream, snapshot, onMessage, onNotice }: UseDuoOptions) {
  const [status, setStatus] = useState<DuoStatus>('off')
  const [transport, setTransport] = useState<DuoTransport | null>(null)
  const [code, setCode] = useState<string | null>(null)
  const [isHost, setIsHost] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [remotePreview, setRemotePreview] = useState<string | null>(null)
  const [peerCameraReady, setPeerCameraReady] = useState(false)

  const socketRef = useRef<WebSocket | null>(null)
  const peerRef = useRef<RTCPeerConnection | null>(null)
  const channelRef = useRef<RTCDataChannel | null>(null)
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([])
  const initiatorRef = useRef(false)
  const restartedRef = useRef(false)
  const transportRef = useRef<DuoTransport | null>(null)
  const linkTimerRef = useRef<number | null>(null)
  const inboxRef = useRef(new PhotoInbox())
  const streamRef = useRef<MediaStream | null>(localStream)
  const snapshotRef = useRef(snapshot)
  const messageRef = useRef(onMessage)
  const noticeRef = useRef(onNotice)

  messageRef.current = onMessage
  noticeRef.current = onNotice
  snapshotRef.current = snapshot
  streamRef.current = localStream

  const signal = useCallback((data: unknown) => {
    const socket = socketRef.current
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'signal', data }))
    }
  }, [])

  const clearLinkTimer = useCallback(() => {
    if (linkTimerRef.current !== null) {
      window.clearTimeout(linkTimerRef.current)
      linkTimerRef.current = null
    }
  }, [])

  /**
   * Sends over whichever transport is available: the data channel when it is
   * open, otherwise wrapped in a relay frame on the signaling socket. Every
   * caller above this line is transport-agnostic.
   */
  const sendWire = useCallback((message: WireMessage) => {
    const body = JSON.stringify(message)

    const channel = channelRef.current
    if (channel?.readyState === 'open') {
      channel.send(body)
      return true
    }

    const socket = socketRef.current
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'relay', payload: body }))
      return true
    }

    return false
  }, [])

  /** Bytes waiting on whichever transport is in use. */
  const bufferedAmount = useCallback(() => {
    const channel = channelRef.current
    if (channel?.readyState === 'open') return channel.bufferedAmount
    return socketRef.current?.bufferedAmount ?? 0
  }, [])

  const handleWire = useCallback((message: WireMessage) => {
    switch (message.t) {
      case 'photo-start':
        inboxRef.current.start(message.id, message.round, message.chunks)
        break

      case 'photo-chunk':
        inboxRef.current.chunk(message.id, message.index, message.body)
        break

      case 'photo-end': {
        const photo = inboxRef.current.end(message.id)
        if (photo) messageRef.current({ t: 'photo', ...photo })
        break
      }

      case 'preview':
        setRemotePreview(message.frame)
        break

      case 'hello':
        setPeerCameraReady(message.cameraReady)
        messageRef.current(message)
        break

      case 'camera':
        setPeerCameraReady(message.ready)
        break

      default:
        messageRef.current(message as DuoMessage)
        break
    }
  }, [])

  const dropPeer = useCallback(() => {
    channelRef.current?.close()
    channelRef.current = null
    peerRef.current?.close()
    peerRef.current = null
    pendingIceRef.current = []
    setRemoteStream(null)
  }, [])

  const teardownPeer = useCallback(() => {
    clearLinkTimer()
    dropPeer()
    inboxRef.current.clear()
    transportRef.current = null
    setTransport(null)
    setRemotePreview(null)
    setPeerCameraReady(false)
  }, [clearLinkTimer, dropPeer])

  /**
   * The booth still works when the browsers cannot reach each other: the
   * session rides the signaling socket both of them are already connected to.
   * Both sides land here independently — via their own timeout, their own ICE
   * failure, or on receiving the first relay frame from the other.
   */
  const switchToRelay = useCallback(
    (reason: string, announce: boolean) => {
      if (transportRef.current) return

      console.info('[booth] transport: relay —', reason)
      transportRef.current = 'relay'
      setTransport('relay')
      clearLinkTimer()
      dropPeer()
      setStatus('live')

      if (announce) {
        noticeRef.current('Direct link blocked — running through the booth server instead.')
      }

      sendWire({ t: 'hello', cameraReady: Boolean(streamRef.current) })
    },
    [clearLinkTimer, dropPeer, sendWire],
  )

  const armLinkTimer = useCallback(() => {
    clearLinkTimer()
    linkTimerRef.current = window.setTimeout(() => {
      switchToRelay('direct connection timed out', true)
    }, LINK_TIMEOUT_MS)
  }, [clearLinkTimer, switchToRelay])

  const leave = useCallback(() => {
    const socket = socketRef.current
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'leave' }))
    }
    socket?.close()
    socketRef.current = null
    teardownPeer()
    setStatus('off')
    setCode(null)
    setIsHost(false)
    setError(null)
  }, [teardownPeer])

  const wireChannel = useCallback(
    (channel: RTCDataChannel) => {
      channelRef.current = channel
      channel.bufferedAmountLowThreshold = BUFFER_LOW

      channel.onopen = () => {
        if (transportRef.current === 'relay') return
        console.info('[booth] transport: p2p')
        transportRef.current = 'p2p'
        setTransport('p2p')
        clearLinkTimer()
        setStatus('live')
        sendWire({ t: 'hello', cameraReady: Boolean(streamRef.current) })
      }

      channel.onclose = () => {
        if (transportRef.current !== 'p2p') return
        setStatus((current) => (current === 'live' ? 'waiting' : current))
      }

      channel.onmessage = (event) => {
        try {
          handleWire(JSON.parse(String(event.data)) as WireMessage)
        } catch {
          // Ignore anything unparseable.
        }
      }
    },
    [clearLinkTimer, handleWire, sendWire],
  )

  const createPeer = useCallback(
    (initiator: boolean) => {
      dropPeer()

      const peer = new RTCPeerConnection({ iceServers: iceServers() })
      peerRef.current = peer
      initiatorRef.current = initiator
      restartedRef.current = false
      const found = { host: 0, srflx: 0, relay: 0 }

      const stream = streamRef.current
      if (stream) {
        for (const track of stream.getTracks()) peer.addTrack(track, stream)
      }

      peer.ontrack = (event) => {
        setRemoteStream(event.streams[0] ?? null)
      }

      peer.onicecandidate = (event) => {
        if (!event.candidate) {
          console.info('[booth] ICE candidates gathered:', found, 'TURN configured:', hasTurn())
          return
        }
        const type = event.candidate.type as keyof typeof found | null
        if (type && type in found) found[type] += 1
        signal({ candidate: event.candidate.toJSON() })
      }

      peer.onconnectionstatechange = () => {
        console.info('[booth] connection state:', peer.connectionState)
        if (peer.connectionState !== 'failed') return

        // One ICE restart first — a fair share of failures are transient.
        if (initiatorRef.current && !restartedRef.current) {
          restartedRef.current = true
          console.info('[booth] retrying with an ICE restart')
          void (async () => {
            try {
              const offer = await peer.createOffer({ iceRestart: true })
              await peer.setLocalDescription(offer)
              signal({ sdp: peer.localDescription })
            } catch {
              switchToRelay('ICE restart could not be negotiated', true)
            }
          })()
          return
        }

        switchToRelay('no direct route between these networks', true)
      }

      if (initiator) {
        wireChannel(peer.createDataChannel('booth', { ordered: true }))
        void (async () => {
          try {
            const offer = await peer.createOffer()
            await peer.setLocalDescription(offer)
            signal({ sdp: peer.localDescription })
          } catch {
            switchToRelay('could not create an offer', true)
          }
        })()
      } else {
        peer.ondatachannel = (event) => wireChannel(event.channel)
      }

      return peer
    },
    [dropPeer, signal, switchToRelay, wireChannel],
  )

  const handleSignal = useCallback(
    async (data: { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }) => {
      // Already relaying: late handshake traffic is irrelevant.
      if (transportRef.current === 'relay') return

      const peer = peerRef.current ?? createPeer(false)

      if (data.sdp) {
        await peer.setRemoteDescription(new RTCSessionDescription(data.sdp))

        for (const candidate of pendingIceRef.current) {
          await peer.addIceCandidate(candidate).catch(() => undefined)
        }
        pendingIceRef.current = []

        if (data.sdp.type === 'offer') {
          const answer = await peer.createAnswer()
          await peer.setLocalDescription(answer)
          signal({ sdp: peer.localDescription })
        }
        return
      }

      if (data.candidate) {
        if (peer.remoteDescription) {
          await peer.addIceCandidate(data.candidate).catch(() => undefined)
        } else {
          pendingIceRef.current.push(data.candidate)
        }
      }
    },
    [createPeer, signal],
  )

  const connect = useCallback(
    (boothCode: string, hosting: boolean) => {
      leave()
      setStatus('connecting')
      setError(null)
      setCode(boothCode)
      setIsHost(hosting)

      let socket: WebSocket
      try {
        socket = new WebSocket(signalUrl())
      } catch {
        setStatus('error')
        setError('Could not reach the booth server.')
        return
      }

      socketRef.current = socket

      socket.onopen = () => socket.send(JSON.stringify({ type: 'join', code: boothCode }))

      socket.onerror = () => {
        setStatus('error')
        setError('The booth server is not answering. Is `npm run dev` still running?')
      }

      socket.onclose = () => {
        if (socketRef.current === socket) {
          socketRef.current = null
          teardownPeer()
          setStatus((current) => (current === 'error' ? current : 'off'))
        }
      }

      socket.onmessage = (event) => {
        let message: {
          type: string
          code?: string
          initiator?: boolean
          peers?: number
          data?: { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }
          payload?: string
          message?: string
        }
        try {
          message = JSON.parse(String(event.data))
        } catch {
          return
        }

        switch (message.type) {
          case 'joined':
            setCode(message.code ?? boothCode)
            if ((message.peers ?? 1) < 2) {
              setStatus('waiting')
            } else {
              // Someone was already here — they will send the offer.
              setStatus('linking')
              armLinkTimer()
              createPeer(false)
            }
            break

          case 'peer-joined':
            setStatus('linking')
            armLinkTimer()
            createPeer(true)
            break

          case 'signal':
            if (message.data) void handleSignal(message.data)
            break

          case 'relay':
            // The other side gave up on a direct link, so follow them over.
            if (transportRef.current !== 'p2p') {
              switchToRelay('partner is relaying', transportRef.current === null)
            }
            if (message.payload) {
              try {
                handleWire(JSON.parse(message.payload) as WireMessage)
              } catch {
                // Ignore anything unparseable.
              }
            }
            break

          case 'peer-left':
            teardownPeer()
            setStatus('waiting')
            noticeRef.current('Your partner left the booth.')
            break

          case 'error':
            setStatus('error')
            setError(message.message ?? 'Could not join that booth.')
            break

          default:
            break
        }
      }
    },
    [armLinkTimer, createPeer, handleSignal, handleWire, leave, switchToRelay, teardownPeer],
  )

  const invite = useCallback(() => {
    connect(createBoothCode(), true)
  }, [connect])

  const join = useCallback(
    (boothCode: string) => {
      connect(boothCode, false)
    },
    [connect],
  )

  const send = useCallback(
    (message: DuoMessage) => {
      sendWire(message)
    },
    [sendWire],
  )

  /** Photos exceed one message on either transport, so they go over in slices. */
  const sendPhoto = useCallback(
    async (round: number, dataUrl: string) => {
      const id = `${round}-${Math.floor(performance.now())}`
      const parts = planChunks(dataUrl)

      try {
        if (!sendWire({ t: 'photo-start', id, round, chunks: parts.length })) return

        for (let index = 0; index < parts.length; index++) {
          // Let a congested transport catch up rather than piling on.
          let guard = 0
          while (bufferedAmount() > BUFFER_LIMIT && guard < 200) {
            await new Promise((resolve) => window.setTimeout(resolve, 25))
            guard += 1
          }

          if (!sendWire({ t: 'photo-chunk', id, index, body: parts[index] })) return
        }

        sendWire({ t: 'photo-end', id })
      } catch {
        // The transport dropped mid-send; the other side times out and prints
        // whatever arrived rather than hanging.
        noticeRef.current('A photo did not make it across to your partner.')
      }
    },
    [bufferedAmount, sendWire],
  )

  // Swapping cameras mid-session should not require a renegotiation.
  useEffect(() => {
    const peer = peerRef.current
    if (!peer || !localStream) return

    const [videoTrack] = localStream.getVideoTracks()
    const sender = peer.getSenders().find((item) => item.track?.kind === 'video')

    if (sender && videoTrack) {
      void sender.replaceTrack(videoTrack).catch(() => undefined)
    } else if (videoTrack) {
      peer.addTrack(videoTrack, localStream)
    }
  }, [localStream])

  // Let the peer know when our camera comes to life.
  useEffect(() => {
    if (status === 'live') sendWire({ t: 'camera', ready: Boolean(localStream) })
  }, [localStream, sendWire, status])

  // Relaying has no video track, so send the partner a trickle of stills.
  useEffect(() => {
    if (status !== 'live' || transport !== 'relay' || !localStream) return

    const id = window.setInterval(() => {
      if (bufferedAmount() > PREVIEW_DROP_ABOVE) return
      const frame = snapshotRef.current?.()
      if (frame) sendWire({ t: 'preview', frame })
    }, PREVIEW_INTERVAL_MS)

    return () => window.clearInterval(id)
  }, [bufferedAmount, localStream, sendWire, status, transport])

  useEffect(() => () => leave(), [leave])

  return {
    status,
    transport,
    code,
    isHost,
    error,
    remoteStream,
    remotePreview,
    peerCameraReady,
    inviteUrl: code ? boothInviteUrl(code) : null,
    invite,
    join,
    leave,
    send,
    sendPhoto,
  }
}
