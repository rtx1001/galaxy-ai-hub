export function DropImageOverlay() {
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center border-4 border-dashed bg-[#131314]/80 backdrop-blur-sm" style={{ borderColor: "var(--accent-soft-strong)" }}>
      <div className="rounded-[28px] bg-[#1e1f20] px-8 py-6 text-center shadow-xl ring-1 ring-[#282a2c]">
        <div className="font-title text-2xl text-[#e3e3e3]">Drop an image here</div>
        <div className="mt-2 text-sm text-[#c4c7c5]">The assistant will add it to the chat with your instruction.</div>
      </div>
    </div>
  );
}
