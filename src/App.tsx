import { useCallback, useMemo, useState } from 'react';
import WorldMap from './components/WorldMap';
import CountryPanel from './components/CountryPanel';
import { borders, countries, type CountryFeature } from './lib/countries';

export default function App() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = useMemo(
    () => countries.find((c) => c.id === selectedId) ?? null,
    [selectedId],
  );

  const handleSelect = useCallback((country: CountryFeature | null) => {
    setSelectedId(country ? country.id : null);
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1>
          World<span>4D</span>
        </h1>
        <p>Interactive world map</p>
      </header>
      <main className="app-main">
        <WorldMap
          countries={countries}
          borders={borders}
          selectedId={selectedId}
          onSelect={handleSelect}
        />
        <CountryPanel country={selected} onClear={() => setSelectedId(null)} />
      </main>
    </div>
  );
}
