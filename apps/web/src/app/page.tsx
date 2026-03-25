export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
      <div className="text-center max-w-lg px-4">
        <div className="text-6xl mb-6">🧠</div>
        <h1 className="text-4xl font-bold text-gray-900 mb-4">Zelo</h1>
        <p className="text-xl text-gray-600 mb-2">Gestão de Consultórios de Psicologia</p>
        <div className="mt-8 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-yellow-100 text-yellow-800 text-sm font-medium">
          <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
          Em construção — Slice 0 ✅
        </div>
      </div>
    </main>
  );
}
