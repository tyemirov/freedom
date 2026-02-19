const applicationState = { dataset: null, selectedJurisdictions: new Set() };

function renderSelectionList(){
  const container = document.getElementById("selectionList");
  if (!container || !applicationState.dataset) return;
  
  container.innerHTML = "";
  const jurisdictions = applicationState.dataset.jurisdictions;
  
  jurisdictions.forEach(j => {
    const label = document.createElement("label");
    label.className = "small";
    label.style.display = "inline-flex";
    label.style.alignItems = "center";
    label.style.gap = "6px";
    label.style.margin = "4px";
    label.style.padding = "4px 8px";
    label.style.border = "1px solid var(--border)";
    label.style.borderRadius = "6px";
    label.style.cursor = "pointer";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = applicationState.selectedJurisdictions.has(j.name);
    cb.addEventListener("change", () => {
      if (cb.checked) applicationState.selectedJurisdictions.add(j.name);
      else applicationState.selectedJurisdictions.delete(j.name);
      recomputeAndRender();
    });

    label.appendChild(cb);
    label.appendChild(document.createTextNode(j.name));
    container.appendChild(label);
  });
}

function deepCloneJson(valueObject){ return JSON.parse(JSON.stringify(valueObject)); }
function safeNumber(valueMaybeNumber, defaultValue){
  const parsedNumber = Number(valueMaybeNumber);
  return Number.isFinite(parsedNumber) ? parsedNumber : defaultValue;
}
function clampNumber(valueNumber, minValue, maxValue){ return Math.min(Math.max(valueNumber, minValue), maxValue); }

function normalizeWeights(weightFiscalRaw, weightPermissionRaw){
  const weightFiscalNumber = Math.max(0, safeNumber(weightFiscalRaw, 0));
  const weightPermissionNumber = Math.max(0, safeNumber(weightPermissionRaw, 0));
  const weightSum = weightFiscalNumber + weightPermissionNumber;
  if (weightSum <= 0) { return { weightFiscal: 0.5, weightPermission: 0.5 }; }
  return { weightFiscal: weightFiscalNumber / weightSum, weightPermission: weightPermissionNumber / weightSum };
}

function currentGoals(){
  return {
    rent: document.getElementById("goalHousingRent").checked,
    buy: document.getElementById("goalHousingBuy").checked,
    business: document.getElementById("goalBusiness").checked,
    school: document.getElementById("goalSchoolChoice").checked,
    speech: document.getElementById("goalSpeech").checked,
    privacy: document.getElementById("goalPrivacy").checked,
    mobility: document.getElementById("goalMobility").checked
  };
}

function goalDomainWeights(goalsObject){
  const weights = {
    housing_rent: goalsObject.rent ? 1.0 : 0.25,
    housing_buy: goalsObject.buy ? 1.0 : 0.25,
    business: goalsObject.business ? 1.0 : 0.25,
    school: goalsObject.school ? 1.0 : 0.25,
    speech: goalsObject.speech ? 1.0 : 0.25,
    privacy: goalsObject.privacy ? 1.0 : 0.25,
    mobility: goalsObject.mobility ? 1.0 : 0.25
  };

  let sumValue = 0;
  Object.values(weights).forEach(function(valueNumber){ sumValue += valueNumber; });
  Object.keys(weights).forEach(function(keyName){ weights[keyName] = weights[keyName] / Math.max(1e-9, sumValue); });
  return weights;
}

function computeEffectiveTaxBurden(jurisdiction, incomeUsd, householdType, spendRatio, homeValueUsd){
  const tax = jurisdiction.tax_proxies || {};
  const incomeEffectiveRate = clampNumber(safeNumber(tax.income_effective_rate, 0), 0, 0.8);
  const payrollEffectiveRate = clampNumber(safeNumber(tax.payroll_effective_rate, 0), 0, 0.3);
  const salesEffectiveRate = clampNumber(safeNumber(tax.sales_effective_rate, 0), 0, 0.25);
  const propertyEffectiveRate = clampNumber(safeNumber(tax.property_effective_rate, 0), 0, 0.05);

  const householdAdjustment = tax.household_adjustment || {};
  const householdFactor = clampNumber(safeNumber(householdAdjustment[householdType], 1.0), 0.5, 1.25);
  const adjustedIncomeRate = clampNumber(incomeEffectiveRate * householdFactor, 0, 0.8);

  const incomeTaxPaid = incomeUsd * adjustedIncomeRate;
  const payrollTaxPaid = incomeUsd * payrollEffectiveRate;
  const salesTaxPaid = (incomeUsd * clampNumber(spendRatio, 0, 1)) * salesEffectiveRate;
  const propertyTaxPaid = homeValueUsd * propertyEffectiveRate;

  const totalTaxPaid = incomeTaxPaid + payrollTaxPaid + salesTaxPaid + propertyTaxPaid;
  const effectiveTaxRate = totalTaxPaid / Math.max(1, incomeUsd);

  const marginalKeepPenalty = clampNumber(safeNumber(tax.marginal_keep_penalty, 0), 0, 0.9);
  const marginalKeepRate = 1 - marginalKeepPenalty;

  return { effectiveTaxRate, marginalKeepRate };
}

function normalizeActionFriction(action){
  // Each component is normalized 0..1 and combined.
  // permission_count normalized by a configurable max (default 10)
  // median_days normalized by configurable max (default 180)
  // penalty_severity already 0..1
  const permissionCount = Math.max(0, safeNumber(action.permission_count, 0));
  const medianDays = Math.max(0, safeNumber(action.median_days, 0));
  const penaltySeverity = clampNumber(safeNumber(action.penalty_severity, 0.5), 0, 1);

  const permissionMax = Math.max(1, safeNumber(action.permission_max, 10));
  const daysMax = Math.max(1, safeNumber(action.days_max, 180));

  const permissionNormalized = clampNumber(permissionCount / permissionMax, 0, 1);
  const daysNormalized = clampNumber(medianDays / daysMax, 0, 1);

  // weights within an action: 40% permissions, 40% time, 20% penalty
  return (0.4 * permissionNormalized) + (0.4 * daysNormalized) + (0.2 * penaltySeverity);
}

function computeDomainFrictionFromActions(domainObject){
  const actions = Array.isArray(domainObject.actions) ? domainObject.actions : [];
  if (actions.length === 0) { return 0.5; }
  let frictionSum = 0;
  let weightSum = 0;
  actions.forEach(function(action){
    const actionWeight = Math.max(0.1, safeNumber(action.weight, 1.0));
    const actionFriction = normalizeActionFriction(action);
    frictionSum += actionWeight * actionFriction;
    weightSum += actionWeight;
  });
  return clampNumber(frictionSum / Math.max(1e-9, weightSum), 0, 1);
}

function computePermissionControl(jurisdiction, domainWeights){
  const domains = jurisdiction.domains || {};
  const domainKeys = ["housing_rent","housing_buy","business","school","speech","privacy","mobility"];

  let permissionControlScore = 0;
  const contributions = [];

  domainKeys.forEach(function(domainKey){
    const weightValue = safeNumber(domainWeights[domainKey], 0);
    const domainObject = domains[domainKey] || {};
    const frictionValue = computeDomainFrictionFromActions(domainObject);
    const contributionValue = weightValue * frictionValue;
    permissionControlScore += contributionValue;
    contributions.push({ key: domainKey, friction: frictionValue, contribution: contributionValue });
  });

  contributions.sort(function(a,b){ return b.contribution - a.contribution; });
  return { permissionControlScore: clampNumber(permissionControlScore, 0, 1), contributions };
}

function computeFreedomScore(jurisdiction, settings){
  const taxBurden = computeEffectiveTaxBurden(
    jurisdiction, settings.incomeUsd, settings.householdType, settings.spendRatio, settings.homeValueUsd
  );

  const domainWeights = goalDomainWeights(settings.goals);
  const permission = computePermissionControl(jurisdiction, domainWeights);

  const weights = normalizeWeights(settings.weightFiscalRaw, settings.weightPermissionRaw);

  const fiscalControl = clampNumber(taxBurden.effectiveTaxRate, 0, 1);
  const permissionControl = clampNumber(permission.permissionControlScore, 0, 1);

      const combinedControl = (weights.weightFiscal * fiscalControl) + (weights.weightPermission * permissionControl);
      const freedom = 1 - clampNumber(combinedControl, 0, 1);
  
      const keyToLabel = { housing_rent:"Rent", housing_buy:"Buy/Build", business:"Business", school:"School", speech:"Speech", privacy:"Privacy", mobility:"Mobility" };
      const topDomains = permission.contributions.slice(0,3).map(function(item){    return keyToLabel[item.key] + " (" + Math.round(item.friction * 100) + "%)";
  });

  return {
    jurisdictionName: jurisdiction.name,
    freedomScore: freedom,
    fiscalControlScore: fiscalControl,
    permissionControlScore: permissionControl,
    marginalKeepRate: taxBurden.marginalKeepRate,
    permissionContributions: permission.contributions,
    topDomains
  };
}

function renderTable(sortedResults){
  const body = document.getElementById("resultsBody");
  body.innerHTML = "";
  sortedResults.forEach(function(result, indexValue){
    const row = document.createElement("tr");

    const rankCell = document.createElement("td");
    rankCell.className = "mono";
    rankCell.textContent = String(indexValue + 1);

    const nameCell = document.createElement("td");
    nameCell.innerHTML =
      "<div><strong>" + result.jurisdictionName + "</strong></div>" +
      "<div class='small'>Marginal keep proxy: <span class='mono'>" + Math.round(result.marginalKeepRate * 100) + "%</span></div>";

    const freedomCell = document.createElement("td");
    freedomCell.className = "right mono";
    freedomCell.textContent = (result.freedomScore * 100).toFixed(1);

    const fiscalCell = document.createElement("td");
    fiscalCell.className = "right mono";
    fiscalCell.textContent = (result.fiscalControlScore * 100).toFixed(1);

    const permCell = document.createElement("td");
    permCell.className = "right mono";
    permCell.textContent = (result.permissionControlScore * 100).toFixed(1);

    const topCell = document.createElement("td");
    topCell.className = "small";
    topCell.textContent = result.topDomains.join(", ");

    row.appendChild(rankCell);
    row.appendChild(nameCell);
    row.appendChild(freedomCell);
    row.appendChild(fiscalCell);
    row.appendChild(permCell);
    row.appendChild(topCell);
    body.appendChild(row);
  });
}

function renderRadar(sortedResults){
  if (sortedResults.length === 0) {
    Plotly.purge("radarChart");
    return;
  }
  const topCount = Math.min(5, sortedResults.length);
  const topResults = sortedResults.slice(0, topCount);
  const axisOrder = [
    { key:"housing_rent", label:"Rent" },
    { key:"housing_buy", label:"Buy/Build" },
    { key:"business", label:"Business" },
    { key:"school", label:"School" },
    { key:"speech", label:"Speech" },
    { key:"privacy", label:"Privacy" },
    { key:"mobility", label:"Mobility" }
  ];

  const plotData = topResults.map(function(result){
    const frictionByKey = {};
    result.permissionContributions.forEach(function(item){ frictionByKey[item.key] = item.friction; });

    const rValues = axisOrder.map(function(axis){
      const friction = clampNumber(safeNumber(frictionByKey[axis.key], 0.5), 0, 1);
      return 1 - friction;
    });
    const thetaLabels = axisOrder.map(function(axis){ return axis.label; });

    rValues.push(rValues[0]);
    thetaLabels.push(thetaLabels[0]);

    return { type:"scatterpolar", r:rValues, theta:thetaLabels, fill:"toself", name: result.jurisdictionName };
  });

  const layout = {
    paper_bgcolor:"rgba(0,0,0,0)", plot_bgcolor:"rgba(0,0,0,0)",
    margin:{ l:40, r:40, t:30, b:30 },
    legend:{ font:{ color:"#b8c0e6", size:11 } },
          polar:{
            bgcolor:"rgba(0,0,0,0)",
            radialaxis:{ visible:true, range:[0,1], angle:90, tickangle:90, tickfont:{ color:"#b8c0e6", size:9 }, gridcolor:"rgba(32,40,70,0.5)" },
            angularaxis:{ tickfont:{ color:"#b8c0e6", size:10 }, gridcolor:"rgba(32,40,70,0.5)", rotation:90, direction:"clockwise" }
          },    title:{ text:"Domain Freedom (higher is freer)", font:{ color:"#e8ecff", size:12 } }
  };
  Plotly.newPlot("radarChart", plotData, layout, { displayModeBar:false, responsive:true });
}

function renderScatter(sortedResults){
  if (sortedResults.length === 0) {
    Plotly.purge("scatterChart");
    return;
  }
  const plotData = [{
    type:"scatter", mode:"markers+text",
    x: sortedResults.map(function(r){ return r.fiscalControlScore; }),
    y: sortedResults.map(function(r){ return r.permissionControlScore; }),
    text: sortedResults.map(function(r){ return r.jurisdictionName; }),
    textposition:"top center",
    hovertemplate: "Jurisdiction: %{text}<br>Fiscal control: %{x:.3f}<br>Permission control: %{y:.3f}<extra></extra>",
    marker:{ size:10 }
  }];

  const layout = {
    paper_bgcolor:"rgba(0,0,0,0)", plot_bgcolor:"rgba(0,0,0,0)",
    margin:{ l:55, r:30, t:30, b:50 },
    xaxis:{ title:{ text:"Fiscal control (higher = more tax burden)", font:{ color:"#e8ecff", size:12 } }, tickfont:{ color:"#b8c0e6" }, gridcolor:"rgba(32,40,70,0.8)", zeroline:false, range:[0,0.7] },
    yaxis:{ title:{ text:"Permission control (higher = more friction)", font:{ color:"#e8ecff", size:12 } }, tickfont:{ color:"#b8c0e6" }, gridcolor:"rgba(32,40,70,0.8)", zeroline:false, range:[0,0.9] },
    title:{ text:"Control Map (lower-left is freer)", font:{ color:"#e8ecff", size:12 } },
    showlegend:false
  };

  Plotly.newPlot("scatterChart", plotData, layout, { displayModeBar:false, responsive:true });
}

function setSliderLabels(){
  document.getElementById("weightFiscalValue").textContent = String(document.getElementById("weightFiscal").value);
  document.getElementById("weightPermissionValue").textContent = String(document.getElementById("weightPermission").value);
}

function recomputeAndRender(){
  const dataset = applicationState.dataset;
  if (!dataset || !Array.isArray(dataset.jurisdictions)) {
    return;
  }

  const settings = {
    incomeUsd: safeNumber(document.getElementById("incomeValue").value, 400000),
    householdType: document.getElementById("householdType").value,
    spendRatio: clampNumber(safeNumber(document.getElementById("spendRatio").value, 0.55), 0, 1),
    homeValueUsd: safeNumber(document.getElementById("homeValue").value, 1200000),
    goals: currentGoals(),
    weightFiscalRaw: safeNumber(document.getElementById("weightFiscal").value, 60),
    weightPermissionRaw: safeNumber(document.getElementById("weightPermission").value, 40)
  };

  let results = dataset.jurisdictions.map(function(j){ return computeFreedomScore(j, settings); });
  results.sort(function(a,b){ return b.freedomScore - a.freedomScore; });

  const filteredResults = results.filter(r => 
    applicationState.selectedJurisdictions.has(r.jurisdictionName)
  );

  renderTable(filteredResults);
  renderRadar(filteredResults);
  renderScatter(filteredResults);
}

async function loadDefaultDataset() {
  try {
    const response = await fetch("full_states_dataset.json");
    if (!response.ok) throw new Error("Could not load full_states_dataset.json");
    const data = await response.json();
    
    applicationState.dataset = data;
    applicationState.selectedJurisdictions.clear();
    
    // Default select first few if many
    if (data.jurisdictions.length > 0) {
      data.jurisdictions.slice(0, 5).forEach(j => applicationState.selectedJurisdictions.add(j.name));
    }
    
    renderSelectionList();
    recomputeAndRender();
  } catch (error) {
    console.error("Dataset load error:", error);
  }
}

function resetDefaults(){
  document.getElementById("incomeValue").value = 400000;
  document.getElementById("householdType").value = "couple_two_kids";
  document.getElementById("spendRatio").value = 0.55;
  document.getElementById("homeValue").value = 1200000;

  document.getElementById("goalHousingRent").checked = true;
  document.getElementById("goalHousingBuy").checked = true;
  document.getElementById("goalBusiness").checked = true;
  document.getElementById("goalSchoolChoice").checked = false;
  document.getElementById("goalSpeech").checked = false;
  document.getElementById("goalPrivacy").checked = false;
  document.getElementById("goalMobility").checked = false;

  document.getElementById("weightFiscal").value = 60;
  document.getElementById("weightPermission").value = 40;
  setSliderLabels();
  recomputeAndRender();
}

function wireEvents(){
  document.getElementById("recomputeButton").addEventListener("click", function(){ recomputeAndRender(); });
  document.getElementById("resetButton").addEventListener("click", function(){ resetDefaults(); });

  document.getElementById("weightFiscal").addEventListener("input", function(){ setSliderLabels(); });
  document.getElementById("weightPermission").addEventListener("input", function(){ setSliderLabels(); });

  document.getElementById("selectAllBtn").addEventListener("click", () => {
    applicationState.dataset.jurisdictions.forEach(j => applicationState.selectedJurisdictions.add(j.name));
    renderSelectionList();
    recomputeAndRender();
  });
  document.getElementById("selectNoneBtn").addEventListener("click", () => {
    applicationState.selectedJurisdictions.clear();
    renderSelectionList();
    recomputeAndRender();
  });

  const autoIds = [
    "incomeValue","householdType","spendRatio","homeValue",
    "goalHousingRent","goalHousingBuy","goalBusiness","goalSchoolChoice","goalSpeech","goalPrivacy","goalMobility",
    "weightFiscal","weightPermission"
  ];

  autoIds.forEach(function(elementId){
    document.getElementById(elementId).addEventListener("change", function(){
      setSliderLabels();
      recomputeAndRender();
    });
  });
}

loadDefaultDataset();
wireEvents();
setSliderLabels();
recomputeAndRender();
