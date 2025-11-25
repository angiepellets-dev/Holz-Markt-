// Karte initialisieren
const map = L.map("map").setView([51, 11], 5);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  minZoom: 4, maxZoom: 10, attribution: "&copy; OpenStreetMap"
}).addTo(map);

// Farb-Logik für Preise
function colorForPrice(p, keinPreis) {
  if (keinPreis) return "#9e9e9e";
  if (!p || p <= 0 || isNaN(p)) return "#9e9e9e";
  if (p <= 260) return "green";
  if (p < 285) return "orange";
  return "red";
}

// Geocoding-Cache
const geoCache = JSON.parse(localStorage.getItem("geoCachePellets_EU") || "{}");
async function geocode(q) {
  if (geoCache[q] && geoCache[q].country_code) return geoCache[q];

  const r = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&q=${encodeURIComponent(q)}&limit=1&accept-language=de`
  );
  const d = await r.json();

  if (d.length) {
    const item = d[0];
    const obj = {
      lat: +item.lat,
      lon: +item.lon,
      country: item.address?.country || "",
      country_code: item.address?.country_code?.toLowerCase() || ""
    };
    geoCache[q] = obj;
    localStorage.setItem("geoCachePellets_EU", JSON.stringify(geoCache));
    return obj;
  }
  return null;
}

// Marker-Icons
const blauesDreieck = L.divIcon({
  className: "custom-triangle",
  html: `<svg width="24" height="24"><polygon points="12,2 22,22 2,22" fill="blue" stroke="black"/></svg>`,
  iconAnchor: [12,22]
});
const lilaDreieck = L.divIcon({
  className: "custom-triangle-purple",
  html: `<svg width="24" height="24"><polygon points="12,2 22,22 2,22" fill="purple" stroke="black"/></svg>`,
  iconAnchor: [12,22]
});
const hellgelbesDreieck = L.divIcon({
  className: "custom-triangle-yellow",
  html: `<svg width="24" height="24"><polygon points="12,2 22,22 2,22" fill="#fff9c4" stroke="black"/></svg>`,
  iconAnchor: [12,22]
});

// Google-Sheets-URLs
const sheetUrlPellets =
"https://docs.google.com/spreadsheets/d/1f1oD1TlYWPRbD12d05yIGkqmXVygVt3ZHLk9U0bKoTs/export?format=csv";
const sheetUrlSaegerestholz =
"https://docs.google.com/spreadsheets/d/1f1oD1TlYWPRbD12d05yIGkqmXVygVt3ZHLk9U0bKoTs/export?format=csv&gid=1423782020";
const sheetUrlKunden =
"https://docs.google.com/spreadsheets/d/1DaiLyZbhJkdSQ1PHbJQmguIrDnGrrhiAVgJC4PJO8vA/export?format=csv&gid=0";

let werke = [], kunden = [], alleMarker = [], selectedPoints = [], routeLine = null;
let avgPriceByCountry = {};

// CSV-Parser
function parseFirmenWithHeader(rows){
  const lc = s => String(s||"").toLowerCase();
  const keys = Object.keys(rows[0]||{});
  const findKey = cands => keys.find(k => cands.includes(lc(k)));

  const nameKey = findKey(["firma","werk","name"]) || keys[0];
  const ortKey  = findKey(["ort","stadt","location","standort","adresse"]) || keys[1];
  const preisKey = findKey(["preis","€/srm","werkspreis","price"]);
  const sackPreisKey = findKey(["preis_sack","sackpreis","bag_price"]);
  const zertKey = findKey(["zert","cert"]);
  const sackKey = findKey(["sack","bag"]);
  const produktKey = findKey(["produkt","products"]);
  const abnehmerKey = findKey(["abnehmer","kunde"]);

  return rows
    .filter(x => (x[nameKey]||"").trim() && (x[ortKey]||"").trim())
    .map(x => ({
      firma: x[nameKey]?.trim() || "",
      ort: x[ortKey]?.trim() || "",
      preis: parseFloat(String(x[preisKey]||"0").replace(",", ".")),
      preisSack: parseFloat(String(x[sackPreisKey]||"0").replace(",", ".")),
      zert: x[zertKey]?.trim() || "",
      sack: x[sackKey]?.trim() || "",
      produkt: x[produktKey]?.trim() || "",
      abnehmer: x[abnehmerKey]?.trim() || ""
    }));
}

// Daten laden
async function ladeDaten() {
  const pellets = await new Promise(res =>
    Papa.parse(sheetUrlPellets, {
      download:true, header:true,
      complete:r => res(normalizePreise(parseFirmenWithHeader(r.data)))
    })
  );

  const saegerest = await new Promise(res =>
    Papa.parse(sheetUrlSaegerestholz, {
      download:true, header:true,
      complete:r => res(normalizePreise(parseFirmenWithHeader(r.data)))
    })
  );

  const kundenDaten = await new Promise(res =>
    Papa.parse(sheetUrlKunden, {
      download:true, header:true,
      complete:r => {
        const out = r.data
          .filter(x => x.Name && x.Ort)
          .map(x => ({
            name:x.Name.trim(),
            ort:x.Ort.trim(),
            lose:(x.Lose||"").toLowerCase(),
            sackware:(x.Sackware||"").toLowerCase()
          }));
        res(out);
      }
    })
  );

  werke = [
    ...pellets.map(w => ({...w, dataset:"pellets", productType:"pellets"})),
    ...saegerest.map(w => ({...w, dataset:"saegerestholz", productType:"saegerestholz"}))
  ];

  kunden = kundenDaten;
}

// Preise normalisieren
function normalizePreise(d){
  return d.map(w=>{
    if(!isFinite(w.preis) || w.preis<=0){ w.preis = 200; w.keinPreisWerk = true; }
    w.farbeWerk = colorForPrice(w.preis, w.keinPreisWerk);
    return w;
  });
}

// Tooltip
function tooltipHtmlFromMarker(m){
  return `<b>${m.firma}</b><br>${m.ort}<br>${m.preis.toFixed(2)} €`;
}

// Events
function attachWerkInteractions(layer, w, c){
  layer.bindTooltip("", {sticky:true})
    .on("tooltipopen", () => {
      layer.getTooltip().setContent(
        `<b>${w.firma}</b><br>${w.ort}<br>${w.preis.toFixed(2)} €<br>${w.produkt}`
      );
    })
    .on("click", ()=>handleMarkerClick(w.firma, c));
}

// Karte bauen
async function buildMap(){
  alleMarker = [];
  const bounds = L.latLngBounds();
  for(const w of werke){
    const c = await geocode(w.ort);
    if(!c) continue;

    const circleMarker = L.circleMarker([c.lat,c.lon],{
      radius:8, color:w.farbeWerk, fillColor:w.farbeWerk, fillOpacity:0.85
    });
    attachWerkInteractions(circleMarker, w, c);

    alleMarker.push({
      type:"firma", marker:circleMarker,
      firma:w.firma, ort:w.ort,
      preis:w.preis,
      produkt:w.produkt,
      dataset:w.dataset,
      productType:w.productType,
      country_code:c.country_code
    });

    bounds.extend([c.lat,c.lon]);
  }

  for(const k of kunden){
    const c = await geocode(k.ort);
    if(!c) continue;

    const icon = k.sackware==="ja" && k.lose!=="ja" ? lilaDreieck : blauesDreieck;

    const m=L.marker([c.lat,c.lon],{icon})
      .bindTooltip(`<b>${k.name}</b><br>${k.ort}`,{sticky:true})
      .on("click",()=>handleMarkerClick(k.name,c));

    alleMarker.push({
      type:k.sackware==="ja"?"sackkunde":"kunde",
      marker:m,
      country_code:c.country_code
    });

    bounds.extend([c.lat,c.lon]);
  }

  if(bounds.isValid()) map.fitBounds(bounds.pad(0.15));
  updateLayers();
}

function updateLayers(){
  alleMarker.forEach(m=>{
    if (map.hasLayer(m.marker)) map.removeLayer(m.marker);
  });

  for(const m of alleMarker){
    map.addLayer(m.marker);
  }
}
function handleMarkerClick(label,coord){
  selectedPoints.push({label,coord});
  if(selectedPoints.length===2){
    const [a,b] = selectedPoints;
    showRoute(a,b);
    selectedPoints=[];
  }
}

// --------- ROUTE + SÄGESPÄNE-BERECHNUNG ----------
async function showRoute(a,b){
  const url =
    `https://router.project-osrm.org/route/v1/driving/${a.coord.lon},${a.coord.lat};${b.coord.lon},${b.coord.lat}?overview=full&geometries=geojson`;

  const res = await fetch(url);
  const data = await res.json();
  if(!data.routes?.length){ alert("Keine Route!"); return; }

  const route = data.routes[0];
  const distKm = route.distance / 1000;
  const dist = distKm.toFixed(1);
  const coords = route.geometry.coordinates.map(c=>[c[1],c[0]]);

  const werkA = werke.find(w => w.firma === a.label);
  const werkB = werke.find(w => w.firma === b.label);
  const w = werkA || werkB;

  // Standard LKW
  const preisProKm = distKm < 250 ? 2.15 : 1.85;
  const gesamtNormal = ((distKm/24 * preisProKm) + (w?.preis||0)) * 1.05;

  // ---------- SÄGESPÄNE ERKENNUNG ----------
  function isSaegespaene(ww){
    if(!ww) return false;
    const t = (ww.produkt || "").toLowerCase()
      .normalize("NFD").replace(/\p{Diacritic}/gu,"");
    return t.includes("sagespane")
        || t.includes("saegespaene")
        || t.includes("saegespane");
  }

  let endPreis = gesamtNormal;

  if(isSaegespaene(w)){
    const basis = w.preis || 20;
    const ladung = 85;
    const grund = basis * ladung;
    const transport = 2.5 * distKm;
    const sum = (grund + transport) * 1.05;
    endPreis = sum / ladung;
  }

  // Route zeichnen
  if(routeLine) map.removeLayer(routeLine);
  routeLine = L.polyline(coords,{color:"blue",weight:5}).addTo(map);

  const mid = coords[Math.floor(coords.length/2)];
  L.popup()
    .setLatLng(mid)
    .setContent(
      `<b>Route:</b> ${a.label} ↔ ${b.label}<br>
       <b>Entfernung:</b> ${dist} km<br>
       <b>Gesamtkosten:</b> ${endPreis.toFixed(2)} €`
    )
    .openOn(map);

  map.fitBounds(routeLine.getBounds(),{padding:[40,40]});
}

// Klick auf Karte = Route löschen
map.on("click",()=>{
  if(routeLine) map.removeLayer(routeLine);
  routeLine=null;
  selectedPoints=[];
  map.closePopup();
});

// Start
(async ()=>{
  await ladeDaten();
  await buildMap();
})();
