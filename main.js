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
  if (geoCache[q] && geoCache[q].country_code) {
    return geoCache[q];
  }
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
  console.warn("Kein Geocode-Treffer:", q);
  return null;
}

// Marker-Icons
const blauesDreieck = L.divIcon({
  className: "custom-triangle",
  html: `<svg width="24" height="24"><polygon points="12,2 22,22 2,22" fill="blue" stroke="black"/></svg>`,
  iconAnchor: [12,22], popupAnchor: [0,-20]
});
const lilaDreieck = L.divIcon({
  className: "custom-triangle-purple",
  html: `<svg width="24" height="24"><polygon points="12,2 22,22 2,22" fill="purple" stroke="black"/></svg>`,
  iconAnchor: [12,22], popupAnchor: [0,-20]
});
const hellgelbesDreieck = L.divIcon({
  className: "custom-triangle-yellow",
  html: `<svg width="24" height="24"><polygon points="12,2 22,22 2,22" fill="#fff9c4" stroke="black"/></svg>`,
  iconAnchor: [12,22], popupAnchor: [0,-20]
});

// Google-Sheets-URLs
const sheetUrlPellets = "https://docs.google.com/spreadsheets/d/1f1oD1TlYWPRbD12d05yIGkqmXVygVt3ZHLk9U0bKoTs/export?format=csv";
const sheetUrlSaegerestholz = "https://docs.google.com/spreadsheets/d/1f1oD1TlYWPRbD12d05yIGkqmXVygVt3ZHLk9U0bKoTs/export?format=csv&gid=1423782020";
const sheetUrlKunden = "https://docs.google.com/spreadsheets/d/1DaiLyZbhJkdSQ1PHbJQmguIrDnGrrhiAVgJC4PJO8vA/export?format=csv&gid=0";

let werke = [], kunden = [], alleMarker = [], selectedPoints = [], routeLine = null;
let avgPriceByCountry = {};

// CSV -> Objekte
function parseFirmenWithHeader(rows){
  const lc = (s)=>String(s||"").toLowerCase();
  const keys = Object.keys(rows[0]||{});
  const findKey = (cands) => keys.find(k => cands.includes(lc(k)));

  const nameKey = findKey(["firma","name","werk"]) || keys[0];
  const ortKey  = findKey(["ort","stadt","location","standort","adresse"]) || keys[1];
  const preisKey = findKey(["preis","price","€/t","werkspreis","€/srm"]);
  const sackPreisKey = findKey(["preis_sack","sackpreis","bag_price"]);
  const zertKey = findKey(["zertifikate","zertifikat","zert"]);
  const sackKey = findKey(["sackware","sack"]);
  const produktKey = findKey(["produkt","produkte"]);
  const abnehmerKey = findKey(["abnehmer","kunden"]);

  return rows
    .filter(x => x?.[nameKey] && x?.[ortKey])
    .map(x => ({
      firma: x[nameKey]?.trim(),
      ort: x[ortKey]?.trim(),
      preis: parseFloat(String(x?.[preisKey]||"0").replace(",",".")),
      preisSack: parseFloat(String(x?.[sackPreisKey]||"0").replace(",",".")),
      zert: x[zertKey] || "",
      sack: x[sackKey] || "",
      produkt: x[produktKey] || "",
      abnehmer: x[abnehmerKey] || ""
    }));
}

// Daten laden
async function ladeDaten() {
  const pelletsPromise = new Promise(resolve => {
    Papa.parse(sheetUrlPellets, {
      download:true, header:true,
      complete:r=>{
        let d = parseFirmenWithHeader(r.data);
        resolve(normalizePreise(d));
      }
    });
  });

  const saegPromise = new Promise(resolve => {
    Papa.parse(sheetUrlSaegerestholz, {
      download:true, header:true,
      complete:r=>{
        let d = parseFirmenWithHeader(r.data);
        resolve(normalizePreise(d));
      }
    });
  });

  const kundenPromise = new Promise(resolve=>{
    Papa.parse(sheetUrlKunden,{
      download:true, header:true,
      complete:r=>{
        resolve(r.data
          .filter(x=>x.name && x.ort)
          .map(x=>({
            name:x.name.trim(),
            ort:x.ort.trim(),
            lose:(x.lose||"").toLowerCase(),
            sackware:(x.sackware||"").toLowerCase()
          })));
      }
    });
  });

  const [pellets, saeg, kd] = await Promise.all([
    pelletsPromise, saegPromise, kundenPromise
  ]);

  werke = [
    ...pellets.map(w=>({...w,dataset:"pellets",productType:"pellets",source:"pellets",isSaegerAbnehmer:(w.abnehmer||"").toLowerCase().includes("sägerest")})),
    ...saeg.map(w=>({...w,dataset:"saegerestholz",productType:"saegerestholz",source:"saeg",isSaegerAbnehmer:false}))
  ];
  kunden = kd;
}

// Preise normalisieren
function normalizePreise(daten){
  const a = daten.filter(w=>w.preis>0);
  const b = daten.filter(w=>w.preisSack>0);
  const avgWerk = a.length ? a.reduce((s,x)=>s+x.preis,0)/a.length : 0;
  const avgSack = b.length ? b.reduce((s,x)=>s+x.preisSack,0)/b.length : 0;

  return daten.map(w=>{
    if(w.preis<=0){w.preis=avgWerk;w.keinPreisWerk=true;} else w.keinPreisWerk=false;
    if(w.preisSack<=0){w.preisSack=avgSack;w.keinPreisSack=true;} else w.keinPreisSack=false;
    w.farbeWerk = colorForPrice(w.preis,w.keinPreisWerk);
    w.farbeSack = colorForPrice(w.preisSack,w.keinPreisSack);
    return w;
  });
}

// Tooltip
function tooltipHtmlFromMarker(m){
  const useSack = sackFilterAktiv();
  const preisNow = useSack ? m.preisSack : m.preis;
  const zertInfo = m.zert ? `<br><b>Zert:</b> ${m.zert}` : "";
  const sackInfo = m.sack ? `<br><b>Sack:</b> ${m.sack}` : "";
  const prodInfo = m.produkt ? `<br><b>Produkt:</b> ${m.produkt}` : "";
  return `<b>${m.firma}</b><br>${m.ort}<br>${preisNow.toFixed(2)} €${zertInfo}${sackInfo}${prodInfo}`;
}

// attach interactions
function attachWerkInteractions(layer, w, c){
  layer.bindTooltip("",{sticky:true})
    .on("tooltipopen",()=>{
      layer.getTooltip().setContent(tooltipHtmlFromMarker({
        ...w,
        country_code:c.country_code
      }));
    })
    .on("click",()=>handleMarkerClick(w.firma,c));
}

// Karte aufbauen
async function buildMap(){
  alleMarker=[];
  const bounds=L.latLngBounds();

  for(const w of werke){
    const c = geoCache[w.ort] || await geocode(w.ort);
    if(!c) continue;

    const farbe = sackFilterAktiv() ? w.farbeSack : w.farbeWerk;

    const circle = L.circleMarker([c.lat,c.lon],{
      radius:8,color:farbe,fillColor:farbe,fillOpacity:0.85
    });
    attachWerkInteractions(circle,w,c);

    let triangle=null;
    if(w.isSaegerAbnehmer){
      triangle=L.marker([c.lat,c.lon],{icon:hellgelbesDreieck});
      attachWerkInteractions(triangle,w,c);
    }

    alleMarker.push({
      type:"firma",marker:circle,circleMarker:circle,triangleMarker:triangle,
      firma:w.firma,ort:w.ort,preis:w.preis,preisSack:w.preisSack,
      produkt:w.produkt,source:w.source,productType:w.productType,
      isSaegerAbnehmer:w.isSaegerAbnehmer,country_code:c.country_code
    });
    bounds.extend([c.lat,c.lon]);
  }

  for(const k of kunden){
    const c = geoCache[k.ort] || await geocode(k.ort);
    if(!c) continue;

    const isSack = k.sackware==="ja" && k.lose!=="ja";
    const icon = isSack ? lilaDreieck : blauesDreieck;

    const m = L.marker([c.lat,c.lon],{icon})
      .bindTooltip(`<b>${k.name}</b><br>${k.ort}`,{sticky:true})
      .on("click",()=>handleMarkerClick(k.name,c));

    alleMarker.push({type:isSack?"sackkunde":"kunde",marker:m,country_code:c.country_code});
    bounds.extend([c.lat,c.lon]);
  }

  if(bounds.isValid()) map.fitBounds(bounds.pad(0.15));
  updateLayers();
}

// Länderfilter
function getSelectedCountries(){
  const arr=[...document.querySelectorAll(".countryChk:checked")].map(x=>x.value);
  return (arr.includes("all")||arr.length===0)?["all"]:arr;
}

function sackFilterAktiv(){
  return document.getElementById("chkSackFireflies").checked ||
         document.getElementById("chkSack15kg").checked;
}

// Layer aktualisieren
function updateLayers(){
  alleMarker.forEach(m=>{
    if(map.hasLayer(m.marker)) map.removeLayer(m.marker);
    if(m.circleMarker && map.hasLayer(m.circleMarker)) map.removeLayer(m.circleMarker);
    if(m.triangleMarker && map.hasLayer(m.triangleMarker)) map.removeLayer(m.triangleMarker);
  });

  const selected = getSelectedCountries();
  const noFilter = selected.includes("all");
  const showPellets = document.getElementById("chkPellets").checked;
  const showSaeg = document.getElementById("chkSaegerestholzNord").checked;

  for(const m of alleMarker){

    // Kunden
    if(m.type==="kunde" || m.type==="sackkunde"){
      if(showPellets){
        if(noFilter || selected.includes(m.country_code)){
          map.addLayer(m.marker);
        }
      }
      continue;
    }

    // Firmen
    if(m.productType==="saegerestholz" && !showSaeg) continue;
    if(m.productType==="pellets" && !showPellets){
      if(!(m.isSaegerAbnehmer && showSaeg)) continue;
    }

    if(!noFilter && !selected.includes(m.country_code)) continue;

    let marker = m.circleMarker;

    if(m.isSaegerAbnehmer && !showPellets && showSaeg && m.triangleMarker){
      marker=m.triangleMarker;
    }

    if(marker) map.addLayer(marker);
  }
}

// Route auswählen
function handleMarkerClick(label,coord){
  selectedPoints.push({label,coord});
  if(selectedPoints.length===2){
    showRoute(selectedPoints[0],selectedPoints[1]);
    selectedPoints=[];
  }
}

// ---------- Route + Kosten (MIT funktionierender Sägespäne-Logik) ----------
async function showRoute(a,b){
  const url = `https://router.project-osrm.org/route/v1/driving/${a.coord.lon},${a.coord.lat};${b.coord.lon},${b.coord.lat}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  const data = await res.json();
  if(!data.routes?.length){
    alert("Keine Route gefunden!");
    return;
  }

  const route=data.routes[0];
  const distKm=route.distance/1000;
  const durationMin=route.duration/60;
  const durationStr = durationMin>60 ? `${Math.floor(durationMin/60)}h ${Math.round(durationMin%60)}min` : `${Math.round(durationMin)}min`;
  const coords=route.geometry.coordinates.map(c=>[c[1],c[0]]);

  const useSack=sackFilterAktiv();

  const werkA = werke.find(w=>w.firma===a.label);
  const werkB = werke.find(w=>w.firma===b.label);
  const w = werkA || werkB;

  // Falls kein Werk erkannt
  if(!w){
    alert("Kein Werk für Kostenberechnung gefunden.");
    return;
  }

  // ROBUSTE ERKENNUNG für Sägespäne
  const text = `${w.produkt||""}`.toLowerCase()
               .normalize("NFD").replace(/\p{Diacritic}/gu,"");

  const istSaegespaene = text.includes("sagespane") || text.includes("saegespaene");

  let gesamtKosten = 0;
  let saegHtml = "";

  if(istSaegespaene){
    // **DEINE richtige Formel → ergibt 24,11 €**
    const basisPreis = w.preis;     // €/srm aus Tabellenblatt
    const ladung = 85;              // srm pro LKW

    const sum = (basisPreis * ladung) + (2.5 * distKm);
    const mitAufschlag = sum * 1.05;
    const jeSrm = mitAufschlag / ladung;

    gesamtKosten = jeSrm;

    saegHtml = `
      <br><b>Sägespäne-Kalkulation</b><br>
      Preis pro srm: ${basisPreis.toFixed(2)} €<br>
      Basis (×85): ${(basisPreis*ladung).toFixed(2)} €<br>
      Transport: 2,5 € × ${distKm.toFixed(1)} km = ${(2.5*distKm).toFixed(2)} €<br>
      + 5 %: ${mitAufschlag.toFixed(2)} €<br>
      <b>Ergebnis pro srm:</b> ${jeSrm.toFixed(2)} €
    `;
  } else {
    // Normale pellet-LKW Berechnung
    const preis = useSack?w.preisSack:w.preis;
    const preisKm = distKm<250?2.15:1.85;
    const teil = (distKm/24)*preisKm;
    gesamtKosten = (teil + preis) * 1.05;
  }

  if(routeLine) map.removeLayer(routeLine);
  routeLine=L.polyline(coords,{color:'blue',weight:5}).addTo(map);

  const mid = coords[Math.floor(coords.length/2)];
  L.popup().setLatLng(mid).setContent(`
    <b>Route:</b> ${a.label} ↔ ${b.label}<br>
    <b>Entfernung:</b> ${distKm.toFixed(1)} km<br>
    <b>Dauer:</b> ${durationStr}<br>
    <b>Gesamtkosten:</b> <span style="color:green;font-size:1.2em">${gesamtKosten.toFixed(2)} €</span>
    ${saegHtml}
  `).openOn(map);

  map.fitBounds(routeLine.getBounds(),{padding:[40,40]});
}
// ---------------------------------------------------------------------------

// Suche
document.getElementById("searchInput").addEventListener("keydown",e=>{
  if(e.key!=="Enter") return;
  const q=e.target.value.toLowerCase();
  const hit=alleMarker.find(m => m.marker?._tooltip?._content?.toLowerCase().includes(q):false);
  if(hit){
    map.setView(hit.marker.getLatLng(),9);
    hit.marker.openTooltip();
  } else alert("Kein Treffer.");
});

// Start
(async()=>{
  await ladeDaten();
  await buildMap();
})();
