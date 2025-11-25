const map = L.map("map").setView([51, 11], 5);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  minZoom: 4, maxZoom: 10, attribution: "&copy; OpenStreetMap"
}).addTo(map);

function colorForPrice(p, keinPreis) {
  if (keinPreis) return "#9e9e9e";
  if (!p || p <= 0 || isNaN(p)) return "#9e9e9e";
  if (p <= 260) return "green";
  if (p < 285) return "orange";
  return "red";
}

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
      country: item.address && item.address.country ? item.address.country : "",
      country_code: item.address && item.address.country_code ? item.address.country_code.toLowerCase() : ""
    };
    geoCache[q] = obj;
    localStorage.setItem("geoCachePellets_EU", JSON.stringify(geoCache));
    return obj;
  }
  console.warn("Kein Geocode-Treffer:", q);
  return null;
}

const blauesDreieck = L.divIcon({
  className: "custom-triangle",
  html: `<svg width="24" height="24" viewBox="0 0 24 24">
           <polygon points="12,2 22,22 2,22" fill="blue" stroke="black" stroke-width="1"/>
         </svg>`,
  iconAnchor: [12,22],
  popupAnchor: [0,-20]
});
const lilaDreieck = L.divIcon({
  className: "custom-triangle-purple",
  html: `<svg width="24" height="24" viewBox="0 0 24 24">
           <polygon points="12,2 22,22 2,22" fill="purple" stroke="black" stroke-width="1"/>
         </svg>`,
  iconAnchor: [12,22],
  popupAnchor: [0,-20]
});

const hellgelbesDreieck = L.divIcon({
  className: "custom-triangle-yellow",
  html: `<svg width="24" height="24" viewBox="0 0 24 24">
           <polygon points="12,2 22,22 2,22" fill="#fff9c4" stroke="black" stroke-width="1"/>
         </svg>`,
  iconAnchor: [12,22],
  popupAnchor: [0,-20]
});

/* Links */
const sheetUrlPellets = "https://docs.google.com/spreadsheets/d/1f1oD1TlYWPRbD12d05yIGkqmXVygVt3ZHLk9U0bKoTs/export?format=csv";
const sheetUrlSaegerestholz = "https://docs.google.com/spreadsheets/d/1f1oD1TlYWPRbD12d05yIGkqmXVygVt3ZHLk9U0bKoTs/export?format=csv&gid=1423782020";
const sheetUrlKunden = "https://docs.google.com/spreadsheets/d/1DaiLyZbhJkdSQ1PHbJQmguIrDnGrrhiAVgJC4PJO8vA/export?format=csv&gid=0";

let werke = [], kunden = [], alleMarker = [], selectedPoints = [], routeLine = null;
let avgPriceByCountry = {};
function parseFirmenWithHeader(rows){
  const lc = (s)=>String(s||"").toLowerCase();
  const keys = Object.keys(rows[0]||{});
  const findKey = (cands) => keys.find(k => cands.includes(lc(k)));

  const nameKey = findKey(["firma","name","werk"]) || keys[0];
  const ortKey  = findKey(["ort","stadt","location","standort","adresse"]) || keys[1];

  const preisKey = findKey(["preis","price","€/t","euro","euro_t","werkspreis","€/srm","preis_srm"]);
  const sackPreisKey = findKey(["preis_sack","preis sack","sackpreis","bag_price","sackwarepreis","sackware preis","sackwarenpreis","preis_e"]);

  const zertKey = findKey(["zertifikate","zertifikat","zert","cert"]);
  const sackKey = findKey(["sackware","sack","bag","bagged"]);

  const produktKey = findKey(["produkt","produkte","product","products"]);
  const abnehmerKey = findKey(["abnehmer","kunde","kunden","buyer","customer"]);

  return rows
    .filter(x => (x?.[nameKey]||"").toString().trim() && (x?.[ortKey]||"").toString().trim())
    .map(x => ({
      firma: (x[nameKey]||"").toString().trim(),
      ort: (x[ortKey]||"").toString().trim(),
      preis: parseFloat(String(x?.[preisKey] ?? "0").replace(",", ".")),
      preisSack: parseFloat(String(x?.[sackPreisKey] ?? "0").replace(",", ".")),
      zert: (x?.[zertKey]||"").toString().trim(),
      sack: (x?.[sackKey]||"").toString().trim(),
      produkt: produktKey ? (x?.[produktKey] || "").toString().trim() : "",
      abnehmer: abnehmerKey ? (x?.[abnehmerKey] || "").toString().trim() : ""
    }));
}

async function ladeDaten() {
  const pelletsPromise = new Promise((resolve) => {
    Papa.parse(sheetUrlPellets, {
      download: true, header: true,
      complete: (r) => {
        try{
          let daten = [];
          if (r.data && r.data.length && Object.keys(r.data[0]||{}).length > 1) {
            daten = parseFirmenWithHeader(r.data);
          }
          if (!daten.length) {
            Papa.parse(sheetUrlPellets, {
              download: true, header: false,
              complete: (r2) => {
                const rows = r2.data.filter(row => row.length >= 8 && row[0] && row[1]);
                const daten2 = rows.map(row => ({
                  firma: (row[0]||"").trim(),
                  ort:   (row[1]||"").trim(),
                  preis: parseFloat(String(row[2]||"0").replace(",", ".")),
                  preisSack: parseFloat(String(row[4]||"0").replace(",", ".")),
                  zert:  (row[6]||"").trim(),
                  sack:  (row[7]||"").trim(),
                  produkt: "",
                  abnehmer: ""
                }));
                resolve(normalizePreise(daten2));
              }
            });
            return;
          }
          resolve(normalizePreise(daten));
        }catch(e){
          console.error("Header-Parsing Fehler (Pellets):", e);
          resolve([]);
        }
      }
    });
  });

  const saegPromise = new Promise((resolve) => {
    Papa.parse(sheetUrlSaegerestholz, {
      download: true, header: true,
      complete: (r) => {
        try{
          let daten = [];
          if (r.data && r.data.length && Object.keys(r.data[0]||{}).length > 1) {
            daten = parseFirmenWithHeader(r.data);
          }
          if (!daten.length) {
            Papa.parse(sheetUrlSaegerestholz, {
              download: true, header: false,
              complete: (r2) => {
                const rows = r2.data.filter(row => row.length >= 8 && row[0] && row[1]);
                const daten2 = rows.map(row => ({
                  firma: (row[0]||"").trim(),
                  ort:   (row[1]||"").trim(),
                  preis: parseFloat(String(row[2]||"0").replace(",", ".")),
                  preisSack: parseFloat(String(row[4]||"0").replace(",", ".")),
                  zert:  (row[6]||"").trim(),
                  sack:  "",
                  produkt: (row[7]||"").trim(),
                  abnehmer: ""
                }));
                resolve(normalizePreise(daten2));
              }
            });
            return;
          }
          resolve(normalizePreise(daten));
        }catch(e){
          console.error("Header-Parsing Fehler (Sägerestholz Nord):", e);
          resolve([]);
        }
      }
    });
  });

  const kundenPromise = new Promise((resolve)=>{
    Papa.parse(sheetUrlKunden, {
      download:true, header:true,
      complete:(r)=>{
        const headers = Object.keys(r.data[0]||{});
        const nameKey = headers.find(h=>h.toLowerCase().includes("name"))||"name";
        const ortKey = headers.find(h=>["ort","adresse","standort","anschrift","stadt","location"].includes(h.toLowerCase()))||"ort";
        const loseKey = headers.find(h=>h.toLowerCase()==="lose") || "lose";
        const sackKey = headers.find(h=>h.toLowerCase()==="sackware") || "sackware";

        const kundenDaten = r.data
          .map(x=>({
            name:(x[nameKey]||"").trim(),
            ort:(x[ortKey]||"").trim(),
            lose:(x[loseKey]||"").trim().toLowerCase(),
            sackware:(x[sackKey]||"").trim().toLowerCase()
          }))
          .filter(x=>x.name && x.ort);

        resolve(kundenDaten);
      }
    });
  });

  const [pellets, saegerestholz, kundenDaten] =
    await Promise.all([pelletsPromise, saegPromise, kundenPromise]);

  const pelletsMitDataset = pellets.map(w => {
    const abn = (w.abnehmer || "").toLowerCase();
    const istSaegerest = abn.includes("sägerestholz") || abn.includes("saegerestholz");
    return {
      ...w,
      dataset: "pellets",
      productType: "pellets",
      isSaegerAbnehmer: istSaegerest,
      source: "pellets"
    };
  });

  const saegMitDataset = saegerestholz.map(w => ({
    ...w,
    dataset: "saegerestholz",
    productType: "saegerestholz",
    isSaegerAbnehmer: false,
    source: "saegblatt"
  }));

  werke = [...pelletsMitDataset, ...saegMitDataset];
  kunden = kundenDaten;
}
function normalizePreise(daten){
  const gültigeWerk = daten.filter(w => !isNaN(w.preis) && w.preis > 0);
  const gültigeSack = daten.filter(w => !isNaN(w.preisSack) && w.preisSack > 0);
  const avgWerk = gültigeWerk.length ? (gültigeWerk.reduce((a,b)=>a+b.preis,0)/gültigeWerk.length) : 0;
  const avgSack = gültigeSack.length ? (gültigeSack.reduce((a,b)=>a+b.preisSack,0)/gültigeSack.length) : 0;

  return daten.map(w=>{
    if(isNaN(w.preis)||w.preis<=0){w.preis=avgWerk;w.keinPreisWerk=true;}else w.keinPreisWerk=false;
    if(isNaN(w.preisSack)||w.preisSack<=0){w.preisSack=avgSack;w.keinPreisSack=true;}else w.keinPreisSack=false;
    w.farbeWerk = colorForPrice(w.preis, w.keinPreisWerk);
    w.farbeSack = colorForPrice(w.preisSack, w.keinPreisSack);
    return w;
  });
}

function sackFilterAktiv(){
  const wantFireflies = document.getElementById("chkSackFireflies").checked;
  const want15kg      = document.getElementById("chkSack15kg").checked;
  return (wantFireflies || want15kg);
}

function berechneDurchschnittProLand(){
  const sums = {};
  const counts = {};
  alleMarker.forEach(m => {
    if (m.type !== "firma") return;
    const cc = m.country_code || "";
    if (!cc) return;
    const preis = m.preis;
    if (!isFinite(preis) || preis <= 0) return;
    if (!sums[cc]) { sums[cc] = 0; counts[cc] = 0; }
    sums[cc] += preis;
    counts[cc] += 1;
  });
  avgPriceByCountry = {};
  Object.keys(sums).forEach(cc => {
    avgPriceByCountry[cc] = sums[cc] / counts[cc];
  });
}

function tooltipHtmlFromMarker(m){
  const useSack = sackFilterAktiv();
  const showPellets = document.getElementById("chkPellets")?.checked ?? true;

  const isPelletSaegerAbnehmer =
    m.source === "pellets" && m.isSaegerAbnehmer;

  let preisNow = useSack && isFinite(m.preisSack) && m.preisSack > 0 ? m.preisSack : m.preis;

  let preisTxt = "–";
  if (!( !showPellets && isPelletSaegerAbnehmer )) {
    preisTxt = (isFinite(preisNow) && preisNow > 0) ? `${preisNow.toFixed(2)} €` : "–";
  }

  const zertInfo = m.zert ? `<br><b>Zertifikat:</b> ${m.zert}` : "";
  const sackInfo = m.sack ? `<br><b>Sackware:</b> ${m.sack}` : "";

  let avgTxt = "";
  const avg = avgPriceByCountry[m.country_code];
  if (avg && isFinite(avg)) {
    avgTxt = `<br><b>Landesdurchschnitt:</b> ${avg.toFixed(2)} €`;
  }

  let produktTxt = "";
  let unitTxt = "";

  if (m.dataset === "saegerestholz") {
    unitTxt = "<br><b>Unit:</b> Sägerestholz Nord";
    if (m.produkt) unitTxt += ` – ${m.produkt}`;
  } else if (m.dataset === "pellets") {
    if (isPelletSaegerAbnehmer) {
      unitTxt = "<br><b>Unit:</b> Pellets";
    } else {
      produktTxt = "<br><b>Produkt:</b> Pellets";
    }
  }

  const abnTxt = (!isPelletSaegerAbnehmer && m.abnehmer)
    ? `<br><b>Abnehmer:</b> ${m.abnehmer}` : "";

  return `<b>${m.firma}</b><br>${m.ort}<br>${preisTxt}${zertInfo}${sackInfo}${abnTxt}${produktTxt}${unitTxt}${avgTxt}`;
}

function attachWerkInteractions(layer, w, c){
  layer
    .bindTooltip("", {sticky:true})
    .on("tooltipopen", () => {
      layer.getTooltip().setContent( tooltipHtmlFromMarker({
        firma:w.firma, ort:w.ort,
        preis:w.preis, preisSack:w.preisSack,
        zert:(w.zert||""),
        sack:(w.sack||""),
        abnehmer:(w.abnehmer||""),
        produkt:(w.produkt||""),
        dataset:w.dataset,
        productType:w.productType,
        isSaegerAbnehmer:w.isSaegerAbnehmer,
        source:w.source,
        country_code: (c.country_code || "")
      }));
    })
    .on("click",()=>handleMarkerClick(w.firma,c));
}

async function buildMap(){
  alleMarker = [];
  const bounds=L.latLngBounds();

  for(const w of werke){
    const c=geoCache[w.ort] && geoCache[w.ort].country_code ? geoCache[w.ort] : await geocode(w.ort);
    if(!c)continue;

    const farbeInit = sackFilterAktiv() ? w.farbeSack : w.farbeWerk;

    const circleMarker = L.circleMarker([c.lat,c.lon],{
      radius:8,
      color:farbeInit,
      fillColor:farbeInit,
      fillOpacity:0.85
    });

    attachWerkInteractions(circleMarker, w, c);

    let triangleMarker = null;
    const isPelletSaegerest = w.source === "pellets" && w.isSaegerAbnehmer;

    if (isPelletSaegerest) {
      triangleMarker = L.marker([c.lat,c.lon], {icon: hellgelbesDreieck});
      attachWerkInteractions(triangleMarker, w, c);
    }

    alleMarker.push({
      type:"firma",
      marker: circleMarker,
      circleMarker,
      triangleMarker,
      firma:w.firma,
      ort:w.ort,
      preis:w.preis,
      preisSack:w.preisSack,
      keinPreisWerk:w.keinPreisWerk,
      keinPreisSack:w.keinPreisSack,
      farbeWerk:w.farbeWerk,
      farbeSack:w.farbeSack,
      zert:(w.zert||"").toLowerCase(),
      sack:(w.sack||""),
      abnehmer:(w.abnehmer||""),
      produkt:(w.produkt||""),
      country_code: (c.country_code || ""),
      dataset: w.dataset,
      productType: w.productType,
      isSaegerAbnehmer: w.isSaegerAbnehmer,
      source: w.source
    });
    bounds.extend([c.lat,c.lon]);
  }

  for(const k of kunden){
    const c=geoCache[k.ort] && geoCache[k.ort].country_code ? geoCache[k.ort] : await geocode(k.ort);
    if(!c)continue;

    const isSackOnly = (k.sackware === "ja") && (k.lose !== "ja");
    const iconToUse = isSackOnly ? lilaDreieck : blauesDreieck;

    const m=L.marker([c.lat,c.lon],{icon:iconToUse})
      .bindTooltip(`<b>${k.name}</b><br>${k.ort}`,{sticky:true})
      .on("click",()=>handleMarkerClick(k.name,c));

    alleMarker.push({
      type: isSackOnly ? "sackkunde" : "kunde",
      marker:m,
      country_code: (c.country_code || "")
    });

    bounds.extend([c.lat,c.lon]);
  }

  berechneDurchschnittProLand();

  if(bounds.isValid())map.fitBounds(bounds.pad(0.15));
  updateLayers();
}

function getSelectedCountries() {
  const chks = document.querySelectorAll(".countryChk");
  const selected = [];
  chks.forEach(ch => {
    if (ch.checked) selected.push(ch.value);
  });
  if (selected.length === 0 || selected.includes("all")) return ["all"];
  return selected;
}

function updateCountryButtonLabel() {
  const selected = getSelectedCountries();
  const btn = document.getElementById("countryDropdownBtn");
  if (selected.length === 1 && selected[0] === "all") {
    btn.textContent = "Alle Länder";
  } else {
    const names = {de:"DE",at:"AT",pl:"PL",cz:"CZ",fr:"FR",ch:"CH",be:"BE",sk:"SK"};
    btn.textContent = selected.map(c => names[c] || c).join(", ");
  }
}

function updateLayers(){
  alleMarker.forEach(m=>{
    if (m.marker && map.hasLayer(m.marker)) map.removeLayer(m.marker);
    if (m.circleMarker && map.hasLayer(m.circleMarker)) map.removeLayer(m.circleMarker);
    if (m.triangleMarker && map.hasLayer(m.triangleMarker)) map.removeLayer(m.triangleMarker);
  });

  const selectedCountries = getSelectedCountries();
  const noCountryFilter = selectedCountries.length === 1 && selectedCountries[0] === "all";

  const en         = document.getElementById("chkEnPlus").checked;
  const din        = document.getElementById("chkDINplus").checked;
  const sure       = document.getElementById("chkSURE").checked;
  const cpp        = document.getElementById("chkCPP").checked;
  const ohne       = document.getElementById("chkOhneZert").checked;

  const gruen      = document.getElementById("chkGruen").checked;
  const orange     = document.getElementById("chkOrange").checked;
  const rot        = document.getElementById("chkRot").checked;
  const grau       = document.getElementById("chkGrau").checked;
  const kundenFlag = document.getElementById("chkKunden").checked;
  const sackKundenFlag = document.getElementById("chkSackKunden").checked;

  const wantFireflies = document.getElementById("chkSackFireflies").checked;
  const want15kg      = document.getElementById("chkSack15kg").checked;
  const useSack       = (wantFireflies || want15kg);

  const showPellets = document.getElementById("chkPellets").checked;
  const showSaeg    = document.getElementById("chkSaegerestholzNord").checked;

  for(const m of alleMarker){
    if(m.type === "kunde"){
      if (kundenFlag && showPellets) {
        if (noCountryFilter || (m.country_code && selectedCountries.includes(m.country_code))) {
          m.marker && map.addLayer(m.marker);
        }
      }
      continue;
    }
    if(m.type === "sackkunde"){
      if (sackKundenFlag && showPellets) {
        if (noCountryFilter || (m.country_code && selectedCountries.includes(m.country_code))) {
          m.marker && map.addLayer(m.marker);
        }
      }
      continue;
    }

    if (m.productType === "saegerestholz" && !showSaeg) continue;
    if (m.productType === "pellets") {
      if (!showPellets && !(m.isSaegerAbnehmer && showSaeg)) continue;
    }

    if (useSack) {
      const sNorm = (m.sack||"").toLowerCase().replace(/\s+/g,' ').trim();
      const hasFireflies = sNorm.includes("fireflies");
      const has15kg = sNorm.includes("15 kg") || sNorm.includes("15kg");
      if (wantFireflies && !want15kg && !hasFireflies) continue;
      if (want15kg && !wantFireflies && !has15kg) continue;
      if (wantFireflies && want15kg && !(hasFireflies || has15kg)) continue;
    }

    const z = m.zert || "";
    let zertOK = false;
    if(z.includes("enplus") && en) zertOK = true;
    if(z.includes("dinplus") && din) zertOK = true;
    if(z.includes("sure") && sure) zertOK = true;
    if(z.includes("cpp") && cpp) zertOK = true;
    if(!z && ohne) zertOK = true;
    if(!zertOK) continue;

    const aktiveFarbe = useSack ? m.farbeSack : m.farbeWerk;

    const isGruen  = aktiveFarbe === "green";
    const isOrange = aktiveFarbe === "orange";
    const isRot    = aktiveFarbe === "red";
    const isGrau   = aktiveFarbe === "#9e9e9e";

    let sichtbar = false;
    if(isGruen && gruen) sichtbar = true;
    if(isOrange && orange) sichtbar = true;
    if(isRot && rot) sichtbar = true;
    if(isGrau && grau) sichtbar = true;
    if(!sichtbar) continue;

    if (!noCountryFilter) {
      if (!m.country_code || !selectedCountries.includes(m.country_code)) continue;
    }

    let layerToUse = m.circleMarker || m.marker;

    const isPelletSaegerest = m.source === "pellets" && m.isSaegerAbnehmer;

    if (isPelletSaegerest && !showPellets && showSaeg && m.triangleMarker) {
      layerToUse = m.triangleMarker;
    }

    if (layerToUse && layerToUse.setStyle) {
      layerToUse.setStyle({color:aktiveFarbe, fillColor:aktiveFarbe});
    }

    if (layerToUse && layerToUse.getTooltip) {
      layerToUse.getTooltip().setContent( tooltipHtmlFromMarker(m) );
    }

    m.marker = layerToUse;
    if (layerToUse) map.addLayer(layerToUse);
  }
}

function handleMarkerClick(label,coord){
  selectedPoints.push({label,coord});
  if(selectedPoints.length===2){
    const [a,b]=selectedPoints;
    showRoute(a,b);
    selectedPoints=[];
  }
}

async function showRoute(a,b){
  const url = `https://router.project-osrm.org/route/v1/driving/${a.coord.lon},${a.coord.lat};${b.coord.lon},${b.coord.lat}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  const data = await res.json();
  if(!(data.routes && data.routes.length)){
    alert("Keine Route gefunden!");
    return;
  }

  const route = data.routes[0];
  const dist = (route.distance/1000).toFixed(1);
  const durationMin = route.duration/60;
  const hours = Math.floor(durationMin/60);
  const minutes = Math.round(durationMin%60);
  const durationStr = hours>0?`${hours}h ${minutes}min`:`${minutes}min`;
  const coords = route.geometry.coordinates.map(c=>[c[1],c[0]]);

  const useSack = sackFilterAktiv();

  const werkA = werke.find(w => w.firma === a.label);
  const werkB = werke.find(w => w.firma === b.label);
  const firmeneintrag = werkA || werkB;

  const firmenPreis = firmeneintrag
    ? (useSack ? firmeneintrag.preisSack : firmeneintrag.preis)
    : 0;

  const distKm = parseFloat(dist);
  const preisProKm = distKm < 250 ? 2.15 : 1.85;
  const teilstrecke = distKm / 24;
  const berechnung = teilstrecke * preisProKm;
  const gesamt = ((berechnung + (firmenPreis||0)) * 1.05).toFixed(2);

  function istSaegespaeneWerk(w){
    if (!w) return false;
    if (w.productType !== "saegerestholz") return false;
    const txt = (w.produkt || "").toLowerCase().trim();
    const txtNorm = txt.replace(/ä/g,"ae").replace(/ö/g,"oe").replace(/ü/g,"ue");
    return txt.includes("sägespäne") || txtNorm.includes("saegespaene");
  }

  const saegEintrag = istSaegespaeneWerk(werkA)
    ? werkA
    : (istSaegespaeneWerk(werkB) ? werkB : null);

  let saegCalcHtml = "";
  if (saegEintrag) {
    const basisPreisSrm = 5;
    const ladungSrm = 85;

    const grundpreisGesamt = basisPreisSrm * ladungSrm;
    const transportTeil = 2.15 * distKm;
    const sumVorZuschlag = grundpreisGesamt + transportTeil;
    const sumMit5Prozent = sumVorZuschlag * 1.05;
    const preisJeSrm = sumMit5Prozent / ladungSrm;

    saegCalcHtml = `
      <br><b>Kalkulation Sägespäne (€/srm)</b><br>
      Basis: ${basisPreisSrm.toFixed(2)} €/srm * ${ladungSrm} = ${grundpreisGesamt.toFixed(2)} €<br>
      Transport: 2,15 €/km * ${distKm.toFixed(1)} km = ${transportTeil.toFixed(2)} €<br>
      Zwischensumme: ${sumVorZuschlag.toFixed(2)} €<br>
      inkl. 5 %: ${sumMit5Prozent.toFixed(2)} €<br>
      Ergebnis: <span style="font-weight:bold">${preisJeSrm.toFixed(2)} €/srm</span> (÷ ${ladungSrm})
    `;
  }

  if(routeLine) map.removeLayer(routeLine);
  routeLine = L.polyline(coords,{color:'blue',weight:5,opacity:0.8}).addTo(map);
  const mid = coords[Math.floor(coords.length/2)];
  L.popup().setLatLng(mid).setContent(`
    <b>Route:</b> ${a.label} ↔ ${b.label}<br>
    <b>Entfernung:</b> ${dist} km<br>
    <b>Dauer:</b> ${durationStr}<br>
    <b>Preis pro km:</b> ${preisProKm.toFixed(2)} €<br>
    <b>${useSack ? "Sackware-Preis" : "Werkspreis"}:</b> ${(firmenPreis||0).toFixed(2)} €<br>
    <b>Gesamtkosten:</b> <span style="color:green;font-size:1.1em">${gesamt} €</span>
    ${saegCalcHtml}
  `).openOn(map);
  map.fitBounds(routeLine.getBounds(),{padding:[40,40]});
}

map.on('click', (e) => {
  const t = e.originalEvent && e.originalEvent.target;
  if (t && t.closest) {
    if (t.closest('.leaflet-marker-icon') ||
        t.closest('.leaflet-popup') ||
        t.closest('.leaflet-interactive')) {
      return;
    }
  }
  if (routeLine) {
    map.removeLayer(routeLine);
    routeLine = null;
  }
  selectedPoints = [];
  map.closePopup();
});

document.addEventListener("change", e => {
  if (e.target && e.target.matches('input[type="checkbox"]')) {
    if (e.target.classList.contains("countryChk")) {
      if (e.target.value === "all" && e.target.checked) {
        document.querySelectorAll(".countryChk").forEach(ch => {
          if (ch.value !== "all") ch.checked = false;
        });
      } else if (e.target.value !== "all" && e.target.checked) {
        const allChk = document.querySelector('.countryChk[value="all"]');
        allChk.checked = false;
      }
      updateCountryButtonLabel();
    }
    updateLayers();
  }
});

document.getElementById("countryDropdownBtn").addEventListener("click", () => {
  const menu = document.getElementById("countryDropdownMenu");
  menu.style.display = (menu.style.display === "block") ? "none" : "block";
});

document.addEventListener("click", (e) => {
  const dd = document.getElementById("countryDropdown");
  if (!dd.contains(e.target)) {
    document.getElementById("countryDropdownMenu").style.display = "none";
  }
});

document.getElementById("searchInput").addEventListener("keydown", e => {
  if(e.key === "Enter"){
    const query = e.target.value.toLowerCase().trim();
    if(!query) return;
    const treffer = alleMarker.find(m =>
      m.marker &&
      m.marker.getTooltip &&
      m.marker.getTooltip().getContent &&
      String(m.marker.getTooltip().getContent()).toLowerCase().includes(query)
    );
    if(treffer){
      const latlng = treffer.marker.getLatLng();
      map.setView(latlng,9);
      treffer.marker.openTooltip();
    } else alert("Kein Treffer gefunden.");
  }
});

(async ()=>{
  await ladeDaten();
  await buildMap();
})();
