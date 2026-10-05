/** Velvet curtains, stage glow and film grain — the room the booth sits in. */
export function BoothBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden curtain-bg">
      {/* Valance across the top */}
      <div className="absolute inset-x-0 top-0 h-16 bg-[repeating-linear-gradient(90deg,#8f1329_0px,#5c0a18_18px,#b41c3c_36px,#5c0a18_54px)] shadow-[0_10px_30px_rgba(0,0,0,0.6)] sm:h-24">
        <div className="absolute inset-x-0 bottom-0 h-6 bg-[radial-gradient(circle_at_50%_0,rgba(0,0,0,0.55),transparent_70%)]" />
      </div>

      {/* Side drapes */}
      <div className="absolute inset-y-0 left-0 w-[16vw] max-w-56 bg-[repeating-linear-gradient(90deg,rgba(0,0,0,0.55)_0px,rgba(255,255,255,0.06)_16px,rgba(0,0,0,0.5)_34px)] opacity-80" />
      <div className="absolute inset-y-0 right-0 w-[16vw] max-w-56 bg-[repeating-linear-gradient(90deg,rgba(0,0,0,0.5)_0px,rgba(255,255,255,0.06)_18px,rgba(0,0,0,0.55)_34px)] opacity-80" />

      {/* Stage spotlight */}
      <div className="absolute top-0 left-1/2 h-[70vh] w-[120vw] -translate-x-1/2 bg-[radial-gradient(ellipse_at_top,rgba(255,214,140,0.2),transparent_62%)] animate-flicker" />

      {/* Floor pool of light */}
      <div className="absolute inset-x-0 bottom-0 h-64 bg-[radial-gradient(ellipse_at_bottom,rgba(255,196,110,0.14),transparent_70%)]" />

      <div className="absolute inset-0 grain-overlay opacity-[0.07]" />
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_50%,transparent_45%,rgba(0,0,0,0.6))]" />
    </div>
  )
}
