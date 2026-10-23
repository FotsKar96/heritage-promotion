(async function () {
  const status = document.getElementById("waterfall-map-status");
  const points = window.waterfallPoints || [];
  try {
    const map = L.map("waterfall-map").setView([39, 24], 5);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);
    if (!points.length) {
      status.textContent = "Δεν βρέθηκαν σελίδες καταρρακτών.";
      return;
    }
    const ids = points.map(p => p.qid).filter(q => /^Q\d+$/.test(q));
    if (!ids.length) throw new Error("Δεν βρέθηκαν έγκυρα QID");
    const params = new URLSearchParams({
      action: "wbgetentities", ids: [...new Set(ids)].join("|"),
      props: "claims", format: "json", origin: "*"
    });
    const response = await fetch("https://www.wikidata.org/w/api.php?" + params);
    if (!response.ok) throw new Error("HTTP " + response.status);
    const data = await response.json();
    const bounds = [];
    let count = 0;
    for (const p of points) {
      const claims = data.entities?.[p.qid]?.claims?.P625 || [];
      const valid = claims.filter(x =>
        x.rank !== "deprecated" && x.mainsnak?.datavalue
      );
      const claim = valid.find(x => x.rank === "preferred") || valid[0];
      const c = claim?.mainsnak?.datavalue?.value;
      if (!c || !Number.isFinite(c.latitude) ||
          !Number.isFinite(c.longitude)) continue;
      const position = [c.latitude, c.longitude];
      const link = document.createElement("a");
      link.href = p.url;
      link.textContent = p.title;
      L.marker(position).bindPopup(link).addTo(map);
      bounds.push(position);
      count++;
    }
    if (bounds.length) map.fitBounds(bounds, {padding:[20,20], maxZoom:11});
    status.textContent = `Εμφανίζονται ${count} από ${points.length} σημεία.`;
  } catch (error) {
    status.textContent = "Δεν φορτώθηκαν οι θέσεις. Δοκιμάστε ανανέωση.";
    console.error(error);
  }
})();
