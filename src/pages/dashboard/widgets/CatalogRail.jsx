import React from "react";

import { GameCard } from "../../../components/GameCard.jsx";
import { useNav } from "../../../components/NavContext.jsx";
import { Rail } from "../../../components/Rail.jsx";
import { useWidgetContext } from "../../../components/widgets/WidgetHost.jsx";
import { KRYSTAL_LABELS } from "../../../lib/labels.js";
import { instancesOfBlueprint } from "../../../lib/servers.js";
import { useStore } from "../../../lib/store.js";
import { libraryStore, serversStore } from "../../../lib/stores.js";

// CatalogRail — the whole installable library on a rail, ordered so the actionable half comes first:
// what you could add, then what you already run.
//
// The backend blueprint catalog carries no "added" date (the LibraryEntry DTO has no timestamp), so
// within each half the order is alphabetical — predictable enough to find a game in, which is what
// matters once the rail reaches all of them.

function CatalogRail() {
  const nav = useNav();
  const wc = useWidgetContext();
  const library = useStore(libraryStore, s => s.list);
  const servers = useStore(serversStore, s => s.list);

  const ordered = React.useMemo(() => [...library].sort((a, b) => {
    const ia = instancesOfBlueprint(a, servers).length ? 1 : 0;
    const ib = instancesOfBlueprint(b, servers).length ? 1 : 0;
    if (ia !== ib) return ia - ib;
    return String(a.name || "").localeCompare(String(b.name || ""));
  }), [library, servers]);

  return (
    <Rail
      variant="catalog"
      icon="library"
      title={KRYSTAL_LABELS.catalog || "Catalog"}
      count={library.length}
      items={ordered}
      disabled={!!(wc && wc.editing)}
      onViewAll={() => nav.library()}
      renderItem={g => <GameCard game={g} compact onPick={() => nav.openGame(g.id)} />}
    />
  );
}

export { CatalogRail };
export default CatalogRail;
