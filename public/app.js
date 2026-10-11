const state = { products: [], query: "", store: "all", sort: "relevance" };
const elements = Object.fromEntries(["searchInput","clearButton","storeFilter","sortFilter","productGrid","emptyState","resultTitle","resultCount","recommendation","updatedText"].map(id=>[id,document.getElementById(id)]));
const money = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" });

function normalize(value){return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim()}

// ===== Tìm kiếm =====
// Mỗi từ được lưu 2 dạng: có dấu (acc) và không dấu (plain).
// Từ khóa gõ có dấu thì so khớp đúng dấu ("cá" ≠ "cà"), gõ không dấu thì so khớp bỏ dấu.
function searchWords(value){
  return String(value||"").normalize("NFC").toLowerCase().replace(/đ/g,"d").replace(/[^\p{L}\p{N}]+/gu," ").trim().split(" ").filter(Boolean)
    .map(acc=>{const plain=acc.normalize("NFD").replace(/[\u0300-\u036f]/g,"");return {acc,plain,accented:acc!==plain}});
}
function wordMatch(q,w,prefix){const a=q.accented?q.acc:q.plain,b=q.accented?w.acc:w.plain;return prefix?b.startsWith(a):a===b}
// Tìm cụm từ liên tiếp; từ cuối cho phép khớp tiền tố (người dùng đang gõ dở).
function findPhrase(words,query){
  outer:for(let i=0;i+query.length<=words.length;i++){
    for(let j=0;j<query.length;j++){if(!wordMatch(query[j],words[i+j],j===query.length-1))continue outer}
    return i;
  }
  return -1;
}
function hasAllWords(words,query){return query.every((q,j)=>words.some(w=>wordMatch(q,w,j===query.length-1)))}
function lastWordExact(words,query,start){const q=query[query.length-1];return start>=0?wordMatch(q,words[start+query.length-1],false):words.some(w=>wordMatch(q,w,false))}

// Hàng không phải thực phẩm: chỉ hiện khi từ khóa gọi đúng tên nhóm đó (vd. gõ "sữa tắm" mới ra sữa tắm).
const nonFoodTerms=["sua tam","sua rua mat","sua duong the","dau goi","dau xa","kem duong","kem danh rang","kem chong nang","kem u","kem tay","kem cao rau","nuoc giat","bot giat","nuoc xa","nuoc rua chen","nuoc rua tay","nuoc lau","nuoc tay","nuoc suc mieng","nuoc hoa","tay rua","tay trang","xa bong","xa phong","bang ve sinh","ta bim","ta quan","khan giay","khan uot","khan tam","ban chai","lan xit","xit khu mui","sap thom","tui thom","diet con trung","bao cao su","pin","quan lot","cham soc","my pham","dung cu","do dung","dien gia dung","thiet bi","van phong pham","do choi","hoa pham","ghe nhua","to chen dia","ly bo ly","khuon lam banh","co noi","va san","dao"];
const nonFoodRegex=nonFoodTerms.map(term=>({term,re:new RegExp(`(^| )${term}( |$)`)}));
function nonFoodHits(text){return nonFoodRegex.filter(({re})=>re.test(text)).map(({term})=>term)}

function indexProduct(product){
  const words=searchWords(product.name),categoryWords=searchWords(product.category),brandWords=searchWords(product.brand);
  const plainName=words.map(w=>w.plain).join(" "),plainCategory=categoryWords.map(w=>w.plain).join(" ");
  return {...product,_words:words,_category:categoryWords,_brand:brandWords,_nonFood:[...new Set([...nonFoodHits(plainName),...nonFoodHits(plainCategory)])]};
}
// Từ đứng trước nguyên liệu cho biết đây là sản phẩm chế biến/mang vị (dạng không dấu).
const derivedMarkers=new Set(["vi","huong","nhan","nem","gia","hat","bot","sot","xot","tuong","nuoc","sup","lau","uop","tam","chao","banh","mi","pho","bun","mien","snack","keo","pate","xuc","xich","cha"]);
const seasoningCategory=/(^| )(gia vi|hat nem|bot gia vi|nuoc cham|sot|tuong|bot che bien san|bot cac loai)( |$)/;
function scoreOne(product,query){
  if(!query.length)return 1;
  // Loại hàng phi thực phẩm nếu từ khóa chỉ là một phần của tên nhóm (vd. "sữa" ⊂ "sữa tắm", "kem" ⊂ "kem đánh răng").
  if(product._nonFood.length){
    const plainQuery=` ${query.map(q=>q.plain).join(" ")} `;
    const asksNonFood=product._nonFood.some(term=>plainQuery.includes(` ${term} `));
    const partOfNonFood=product._nonFood.some(term=>` ${term} `.includes(plainQuery)||term.split(" ").some(t=>plainQuery.includes(` ${t} `)));
    if(partOfNonFood&&!asksNonFood)return 0;
  }
  const words=product._words;let value=0;
  const pos=findPhrase(words,query);
  const firstIndex=pos>=0?pos:words.findIndex(w=>wordMatch(query[0],w,query.length===1));
  if(pos===0&&words.length===query.length)value=200;
  else if(pos===0)value=150;
  else if(pos>0)value=120-Math.min(pos,10)*2;
  else if(hasAllWords(words,query))value=firstIndex>=0&&firstIndex<=1?125:70; // "Thịt nạc heo", "MEATDELI Thịt đùi heo"
  // Khớp nguyên từ cuối được ưu tiên hơn khớp tiền tố ("đậu hũ" > "dầu hướng dương" khi gõ "dau hu").
  if(value&&lastWordExact(words,query,pos))value+=20;
  const inCategory=findPhrase(product._category,query)>=0;
  const inBrand=findPhrase(product._brand,query)>=0;
  if(value&&inCategory)value+=30;
  else if(!value&&inCategory)value=45;
  if(!value&&inBrand)value=60;
  // Sản phẩm "mang vị / có nhân" nguyên liệu (hạt nêm thịt heo, bánh bao nhân thịt heo, cháo thịt heo...)
  // bị đẩy xuống dưới nguyên liệu thật, trừ khi người dùng gõ chính loại sản phẩm đó.
  if(value&&firstIndex>0&&!query.some(q=>derivedMarkers.has(q.plain))){
    const before=words.slice(0,firstIndex).map(w=>w.plain);
    if(before.some(w=>derivedMarkers.has(w)))value=Math.round(value*0.45);
  }
  if(value&&seasoningCategory.test(product._category.map(w=>w.plain).join(" "))&&!query.some(q=>derivedMarkers.has(q.plain)))value=Math.min(value,60);
  return value;
}
// Từ đồng nghĩa (dạng không dấu); kết quả khớp qua từ đồng nghĩa bị trừ nhẹ điểm.
const synonymGroups=[["dau hu","dau phu","tau hu"],["ba roi","ba chi"],["trai cay","hoa qua"],["mi tom","mi goi","mi an lien"],["rau mui","ngo ri"]];
function buildQueries(raw){
  const primary=searchWords(raw);if(!primary.length)return [primary];
  const plain=` ${primary.map(q=>q.plain).join(" ")} `,queries=[primary];
  synonymGroups.forEach(group=>group.forEach(term=>{if(!plain.includes(` ${term} `))return;group.filter(other=>other!==term).forEach(other=>queries.push(searchWords(plain.replace(` ${term} `,` ${other} `))))}));
  return queries;
}
function score(product,queries){let best=scoreOne(product,queries[0]);for(let i=1;i<queries.length&&best<200;i++)best=Math.max(best,scoreOne(product,queries[i])-10);return best}
function safeImage(url){return /^https:\/\//.test(url||"")?url:""}
function escapeHtml(value){return String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char])}
function safeLink(url){try{const value=new URL(url);return value.protocol==="https:"?value.href:"#"}catch{return "#"}}

function results(){const query=buildQueries(state.query);let items=state.products.map(p=>({...p,_score:score(p,query)})).filter(p=>p._score>0&&(state.store==="all"||p.supermarket===state.store));items.sort((a,b)=>state.sort==="price-asc"?a.actual_price-b.actual_price:state.sort==="unit-asc"?(a.unit_price??Infinity)-(b.unit_price??Infinity):b._score-a._score||a.actual_price-b.actual_price);return items.slice(0,120)}
function card(product,best){const image=safeImage(product.image_url);return `<article class="card ${best?'best':''}">${best?'<span class="best-badge">GIÁ TỐT NHẤT</span>':''}<div class="product-image">${image?`<img src="${image}" alt="" loading="lazy" referrerpolicy="no-referrer">`:'<span class="image-fallback">₫</span>'}</div><div class="card-body"><span class="store ${product.supermarket}">${product.supermarket==='winmart'?'WinMart':'Bách Hóa Xanh'}</span><h3>${escapeHtml(product.name)}</h3><div class="meta">${escapeHtml(product.brand||product.category||'Sản phẩm')}</div><div class="price-row"><div><div class="price">${money.format(product.actual_price)}${product.size?` <small>/ ${escapeHtml(product.size)}</small>`:''}</div>${product.original_price&&product.original_price>product.actual_price?`<div class="old-price">${money.format(product.original_price)}</div>`:''}${product.unit_price?`<div class="unit-price">Quy đổi: ${money.format(product.unit_price)} / ${escapeHtml(product.unit_label)}</div>`:''}</div><a class="view-link" href="${safeLink(product.product_url)}" target="_blank" rel="noopener" aria-label="Xem sản phẩm" title="Xem sản phẩm">↗</a></div></div></article>`}
function render(){const items=results();const hasQuery=state.query.trim().length>0;elements.resultTitle.textContent=hasQuery?`Kết quả cho “${state.query.trim()}”`:"Sản phẩm mới cập nhật";elements.resultCount.textContent=`Hiển thị ${items.length} sản phẩm`;
  let best=null;if(hasQuery&&items.length){const topScore=Math.max(...items.map(p=>p._score));const threshold=topScore>=150?140:topScore-10;const mostRelevant=items.filter(p=>p._score>=threshold);const comparable=mostRelevant.filter(p=>p.unit_price);best=(comparable.length?comparable:mostRelevant).reduce((a,b)=>(b.unit_price??b.actual_price)<(a.unit_price??a.actual_price)?b:a);elements.recommendation.hidden=false;elements.recommendation.innerHTML=`<div><strong>Lựa chọn tốt nhất: ${escapeHtml(best.name)}</strong><br><span>${best.supermarket==='winmart'?'WinMart':'Bách Hóa Xanh'} · ${money.format(best.actual_price)}${best.size?` / ${escapeHtml(best.size)}`:''}${best.unit_price?` · quy đổi ${money.format(best.unit_price)} / ${escapeHtml(best.unit_label)}`:''}</span></div>`}else elements.recommendation.hidden=true;
  elements.productGrid.innerHTML=items.map(p=>card(p,best?.id===p.id)).join("");elements.emptyState.hidden=items.length>0;elements.clearButton.style.visibility=hasQuery?"visible":"hidden"}

let searchTimer;elements.searchInput.addEventListener("input",e=>{state.query=e.target.value;clearTimeout(searchTimer);searchTimer=setTimeout(render,120)});elements.searchInput.addEventListener("keydown",e=>{if(e.key==="Enter"){clearTimeout(searchTimer);render()}else if(e.key==="Escape"){elements.clearButton.click()}});elements.clearButton.addEventListener("click",()=>{elements.searchInput.value="";state.query="";render();elements.searchInput.focus()});elements.storeFilter.addEventListener("change",e=>{state.store=e.target.value;render()});elements.sortFilter.addEventListener("change",e=>{state.sort=e.target.value;render()});document.querySelectorAll("[data-query]").forEach(button=>button.addEventListener("click",()=>{state.query=button.dataset.query;elements.searchInput.value=state.query;render()}));

try{const data=await fetch(`/catalog.json?t=${Date.now()}`).then(r=>r.json());const seen=new Set();state.products=(data.products||[]).filter(p=>{const key=`${p.supermarket}|${p.name}|${p.size}|${p.actual_price}`;if(seen.has(key))return false;seen.add(key);return true}).map(indexProduct);elements.updatedText.textContent=`${data.count||0} sản phẩm · ${new Date(data.generated_at).toLocaleString('vi-VN')}`;render()}catch{elements.updatedText.textContent="Không tải được dữ liệu";elements.emptyState.hidden=false}

const profileKey = "gia-tot-nutrition-profile-v1";
const planKey = "gia-tot-nutrition-plan-v1";
const profileForm = document.getElementById("profileForm");
const planPanel = document.getElementById("planPanel");
const dayTabs = document.getElementById("dayTabs");
const dailyPlan = document.getElementById("dailyPlan");
let nutritionPlan = null;
let activeDay = 0;
const familyKey="gia-tot-family-profile-v1";
const familyPlanKey="gia-tot-family-plan-v1";
const familyForm=document.getElementById("familyForm");
const familyPlanPanel=document.getElementById("familyPlanPanel");
let familyPlan=null;
let familyActiveDay=0;

const mealLibrary = {
  breakfast: [
    {name:"Yến mạch chuối và sữa chua",ingredients:"yến mạch, chuối, sữa chua",search:"yến mạch",kcal:420,protein:18,diets:["balanced","vegetarian"]},
    {name:"Bánh mì trứng và rau xanh",ingredients:"bánh mì, trứng gà, xà lách, cà chua",search:"trứng gà",kcal:430,protein:22,diets:["balanced","vegetarian"]},
    {name:"Khoai lang, trứng và sữa",ingredients:"khoai lang, trứng gà, sữa tươi",search:"khoai lang",kcal:400,protein:20,diets:["balanced","vegetarian"]},
    {name:"Phở gà ít béo",ingredients:"bánh phở, ức gà, rau thơm",search:"ức gà",kcal:470,protein:31,diets:["balanced"]},
    {name:"Bún riêu chay",ingredients:"bún, đậu hũ, cà chua, nấm",search:"đậu hũ",kcal:430,protein:20,diets:["vegetarian"]}
  ],
  lunch: [
    {name:"Cơm gạo lứt và ức gà",ingredients:"gạo lứt, ức gà, bông cải xanh",search:"ức gà",kcal:610,protein:45,diets:["balanced"]},
    {name:"Cơm cá hồi và rau củ",ingredients:"gạo, cá hồi, cà rốt, bông cải",search:"cá hồi",kcal:650,protein:39,diets:["balanced"]},
    {name:"Bún bò xào rau",ingredients:"bún, thịt bò, hành tây, rau cải",search:"thịt bò",kcal:620,protein:38,diets:["balanced"]},
    {name:"Cơm đậu hũ sốt cà chua",ingredients:"gạo, đậu hũ, cà chua, rau cải",search:"đậu hũ",kcal:560,protein:25,diets:["balanced","vegetarian"]},
    {name:"Mì nấm và trứng",ingredients:"mì, nấm, trứng gà, cải thìa",search:"nấm",kcal:580,protein:27,diets:["vegetarian"]}
  ],
  dinner: [
    {name:"Cá hấp, cơm và rau luộc",ingredients:"cá, gạo, rau cải",search:"cá",kcal:560,protein:40,diets:["balanced"]},
    {name:"Thịt nạc heo áp chảo",ingredients:"thịt nạc heo, khoai tây, salad",search:"thịt heo",kcal:590,protein:42,diets:["balanced"]},
    {name:"Canh gà rau củ và cơm",ingredients:"ức gà, cà rốt, khoai tây, gạo",search:"ức gà",kcal:570,protein:41,diets:["balanced"]},
    {name:"Đậu hũ nấm và cơm",ingredients:"đậu hũ, nấm, gạo, rau xanh",search:"đậu hũ",kcal:540,protein:25,diets:["balanced","vegetarian"]},
    {name:"Trứng cuộn rau củ",ingredients:"trứng gà, cà rốt, nấm, gạo",search:"trứng gà",kcal:520,protein:26,diets:["vegetarian"]}
  ],
  snack: [
    {name:"Sữa chua và trái cây",ingredients:"sữa chua, táo hoặc chuối",search:"sữa chua",kcal:220,protein:10,diets:["balanced","vegetarian"]},
    {name:"Sữa tươi và chuối",ingredients:"sữa tươi, chuối",search:"sữa tươi",kcal:240,protein:10,diets:["balanced","vegetarian"]},
    {name:"Trứng luộc và trái cây",ingredients:"trứng gà, táo",search:"trứng gà",kcal:210,protein:12,diets:["balanced","vegetarian"]}
  ]
};

const mealDetails={
  "Yến mạch chuối và sữa chua":{cost:22000,items:[["yến mạch",50,"g"],["chuối",100,"g"],["sữa chua",100,"g"]]},
  "Bánh mì trứng và rau xanh":{cost:15000,items:[["bánh mì",100,"g"],["trứng gà",2,"quả"],["xà lách",60,"g"],["cà chua",80,"g"]]},
  "Khoai lang, trứng và sữa":{cost:20000,items:[["khoai lang",200,"g"],["trứng gà",1,"quả"],["sữa tươi",200,"ml"]]},
  "Phở gà ít béo":{cost:32000,items:[["bánh phở",150,"g"],["ức gà",120,"g"],["rau thơm",30,"g"]]},
  "Bún riêu chay":{cost:24000,items:[["bún",150,"g"],["đậu hũ",120,"g"],["cà chua",100,"g"],["nấm",60,"g"]]},
  "Cơm gạo lứt và ức gà":{cost:38000,items:[["gạo lứt",100,"g"],["ức gà",160,"g"],["bông cải xanh",150,"g"]]},
  "Cơm cá hồi và rau củ":{cost:65000,items:[["gạo",100,"g"],["cá hồi",150,"g"],["cà rốt",80,"g"],["bông cải xanh",100,"g"]]},
  "Bún bò xào rau":{cost:48000,items:[["bún",180,"g"],["thịt bò",140,"g"],["hành tây",60,"g"],["rau cải",100,"g"]]},
  "Cơm đậu hũ sốt cà chua":{cost:18000,items:[["gạo",100,"g"],["đậu hũ",180,"g"],["cà chua",120,"g"],["rau cải",100,"g"]]},
  "Mì nấm và trứng":{cost:28000,items:[["mì",120,"g"],["nấm",100,"g"],["trứng gà",1,"quả"],["cải thìa",100,"g"]]},
  "Cá hấp, cơm và rau luộc":{cost:40000,items:[["cá",170,"g"],["gạo",90,"g"],["rau cải",180,"g"]]},
  "Thịt nạc heo áp chảo":{cost:42000,items:[["thịt nạc heo",160,"g"],["khoai tây",180,"g"],["xà lách",100,"g"]]},
  "Canh gà rau củ và cơm":{cost:36000,items:[["ức gà",150,"g"],["cà rốt",80,"g"],["khoai tây",120,"g"],["gạo",80,"g"]]},
  "Đậu hũ nấm và cơm":{cost:26000,items:[["đậu hũ",180,"g"],["nấm",100,"g"],["gạo",90,"g"],["rau xanh",120,"g"]]},
  "Trứng cuộn rau củ":{cost:18000,items:[["trứng gà",2,"quả"],["cà rốt",60,"g"],["nấm",60,"g"],["gạo",80,"g"]]},
  "Sữa chua và trái cây":{cost:14000,items:[["sữa chua",100,"g"],["trái cây",150,"g"]]},
  "Sữa tươi và chuối":{cost:12000,items:[["sữa tươi",200,"ml"],["chuối",100,"g"]]},
  "Trứng luộc và trái cây":{cost:15000,items:[["trứng gà",1,"quả"],["trái cây",150,"g"]]}
};

function switchView(view){
  document.getElementById("pricesView").hidden=view!=="prices";
  document.getElementById("nutritionView").hidden=view!=="nutrition";
  document.getElementById("familyView").hidden=view!=="family";
  document.querySelectorAll("[data-view]").forEach(button=>button.classList.toggle("active",button.dataset.view===view));
  window.scrollTo({top:0,behavior:"smooth"});
}
document.querySelectorAll("[data-view]").forEach(button=>button.addEventListener("click",()=>switchView(button.dataset.view)));

function profileFromForm(){return Object.fromEntries(new FormData(profileForm).entries())}
function fillProfile(profile){Object.entries(profile||{}).forEach(([key,value])=>{if(profileForm.elements[key])profileForm.elements[key].value=value})}
function calculateTargets(profile){
  const age=Number(profile.age),height=Number(profile.height),weight=Number(profile.weight),activity=Number(profile.activity);
  const bmr=10*weight+6.25*height-5*age+(profile.sex==="male"?5:-161);
  const adjustment=profile.goal==="lose"?-350:profile.goal==="gain"?300:0;
  const floor=profile.sex==="male"?1500:1200;
  const calories=Math.max(floor,Math.round((bmr*activity+adjustment)/50)*50);
  const proteinFactor=profile.goal==="gain"?1.8:profile.goal==="lose"?1.6:1.4;
  return {calories,protein:Math.round(weight*proteinFactor),bmi:(weight/((height/100)**2)).toFixed(1)};
}
function allowedMeals(type,profile){
  const avoid=normalize(profile.avoid).split(" ").filter(word=>word.length>2);
  let meals=mealLibrary[type].filter(meal=>meal.diets.includes(profile.diet));
  const filtered=meals.filter(meal=>!avoid.some(word=>normalize(`${meal.name} ${meal.ingredients}`).includes(word)));
  return filtered.length?filtered:meals;
}
function pickMeal(type,profile,index,offset,budgetDay){
  let list=allowedMeals(type,profile).map(meal=>({...meal,...mealDetails[meal.name]}));
  if(budgetDay<90000)list=list.sort((a,b)=>a.cost-b.cost).slice(0,1);
  else if(budgetDay<130000)list=list.sort((a,b)=>a.cost-b.cost).slice(0,Math.min(3,list.length));
  return list[(index+offset)%list.length];
}
function createPlan(profile,offset=0){
  const targets=calculateTargets(profile);
  const budget=Number(profile.budget)||500000;
  const budgetDay=profile.budgetPeriod==="day"?budget:budget/7;
  const isFamily=profile.scope==="family";
  const adults=isFamily?Math.max(1,Number(profile.adults)||1):1;
  const children=isFamily?Math.max(0,Number(profile.children)||0):0;
  const seniors=isFamily?Math.max(0,Number(profile.seniors)||0):0;
  const householdSize=adults+children+seniors;
  const householdFactor=isFamily?adults+children*.65+seniors*.85:1;
  const perPersonBudget=budgetDay/householdFactor;
  const pickerBudget=profile.familyStyle==="economy"?Math.min(perPersonBudget,80000):profile.familyStyle==="varied"?Math.max(perPersonBudget,130000):perPersonBudget;
  const days=Array.from({length:7},(_,index)=>{
    const meals=[pickMeal("breakfast",profile,index,offset,pickerBudget),pickMeal("lunch",profile,index*2,offset,pickerBudget),pickMeal("dinner",profile,index*3,offset,pickerBudget)];
    if(profile.meals==="4")meals.push(pickMeal("snack",profile,index,offset,pickerBudget));
    const base=meals.reduce((sum,meal)=>sum+meal.kcal,0);
    const factor=targets.calories/base;
    const portion=Math.min(1.35,Math.max(.75,factor));
    return meals.map(meal=>({...meal,portion,adjustedKcal:Math.round(meal.kcal*factor/10)*10,adjustedCost:Math.round(meal.cost*portion*householdFactor/1000)*1000,adjustedItems:meal.items.map(([name,amount,unit])=>[name,Math.max(1,Math.round(amount*portion*householdFactor/5)*5),unit])}));
  });
  const dayCosts=days.map(day=>day.reduce((sum,meal)=>sum+meal.adjustedCost,0));
  return {profile,targets,days,dayCosts,weeklyCost:dayCosts.reduce((a,b)=>a+b,0),budgetDay,budgetLimitWeek:budgetDay*7,householdSize,householdFactor,offset,createdAt:new Date().toISOString()};
}
function goalLabel(goal){return goal==="lose"?"Giảm cân":goal==="gain"?"Tăng cân":"Giữ cân"}
function renderPlan(){
  if(!nutritionPlan)return;
  const {profile,targets,days}=nutritionPlan;
  document.getElementById("planTitle").textContent=profile.scope==="family"?`Thực đơn gia đình · kế hoạch 7 ngày`:`${goalLabel(profile.goal)} · kế hoạch 7 ngày`;
  document.getElementById("householdSize").textContent=nutritionPlan.householdSize||1;
  document.getElementById("calorieTarget").textContent=targets.calories.toLocaleString("vi-VN");
  document.getElementById("proteinTarget").textContent=targets.protein;
  document.getElementById("dailyCost").textContent=Math.round((nutritionPlan.dayCosts?.[activeDay]||0)/1000)+"k";
  document.getElementById("weeklyCost").textContent=Math.round((nutritionPlan.weeklyCost||0)/1000)+"k";
  document.getElementById("bmiValue").textContent=targets.bmi;
  const names=["Thứ 2","Thứ 3","Thứ 4","Thứ 5","Thứ 6","Thứ 7","Chủ nhật"];
  dayTabs.innerHTML=names.map((name,index)=>`<button class="day-tab ${index===activeDay?'active':''}" type="button" role="tab" aria-selected="${index===activeDay}" data-day="${index}">${name}</button>`).join("");
  const labels=profile.meals==="4"?["Bữa sáng","Bữa trưa","Bữa tối","Bữa phụ"]:["Bữa sáng","Bữa trưa","Bữa tối"];
  const budgetMessage=nutritionPlan.weeklyCost<=nutritionPlan.budgetLimitWeek?`Kế hoạch đang nằm trong ngân sách ${money.format(nutritionPlan.budgetLimitWeek)} mỗi tuần.`:`Ngân sách hiện thấp hơn mức ước tính ${money.format(nutritionPlan.weeklyCost)} mỗi tuần. Hãy chọn 3 bữa, tăng ngân sách hoặc thay nguyên liệu rẻ hơn.`;
  dailyPlan.innerHTML=days[activeDay].map((meal,index)=>`<article class="meal-row"><header><h3>${labels[index]}</h3><span class="meal-calories">≈ ${meal.adjustedKcal} kcal mỗi người</span></header><p><strong>${escapeHtml(meal.name)}</strong><br>${escapeHtml(meal.ingredients)} · ${profile.scope==="family"?`cho ${nutritionPlan.householdSize} người`:`khẩu phần ${Math.round(meal.portion*100)}%`}</p><div class="meal-quantities">${(meal.adjustedItems||[]).map(item=>`<span>${escapeHtml(item[0])}: <strong>${item[1]} ${escapeHtml(item[2])}</strong></span>`).join("")}<span class="meal-cost">Chi phí dự kiến: ${money.format(meal.adjustedCost||0)}</span></div><button class="ingredient-search" type="button" data-ingredient="${escapeHtml(meal.search)}">Tìm giá ${escapeHtml(meal.search)}</button></article>`).join("")+`<p class="plan-note"><strong>${budgetMessage}</strong> Chi phí là ước tính và có thể thay đổi theo cửa hàng hoặc khuyến mãi. Nếu gia đình có trẻ nhỏ, người cao tuổi, phụ nữ mang thai hoặc người có bệnh nền, hãy điều chỉnh riêng với chuyên gia.</p>`;
  const shopping=new Map();days.flat().forEach(meal=>(meal.adjustedItems||[]).forEach(([name,amount,unit])=>{const key=`${name}|${unit}`;const current=shopping.get(key)||{name,amount:0,unit};current.amount+=amount;shopping.set(key,current)}));
  document.getElementById("shoppingList").innerHTML=[...shopping.values()].sort((a,b)=>a.name.localeCompare(b.name,"vi")).map(item=>`<div class="shopping-item"><strong>${escapeHtml(item.name)}</strong><span>${Math.round(item.amount)} ${escapeHtml(item.unit)} mỗi tuần</span></div>`).join("");
  planPanel.hidden=false;
}

profileForm.addEventListener("submit",event=>{
  event.preventDefault();
  const profile=profileFromForm();
  localStorage.setItem(profileKey,JSON.stringify(profile));
  nutritionPlan=createPlan(profile,0);
  localStorage.setItem(planKey,JSON.stringify(nutritionPlan));
  activeDay=0;renderPlan();
  const saved=document.getElementById("profileSaved");saved.hidden=false;setTimeout(()=>saved.hidden=true,1800);
  planPanel.scrollIntoView({behavior:"smooth",block:"start"});
});
dayTabs.addEventListener("click",event=>{const button=event.target.closest("[data-day]");if(!button)return;activeDay=Number(button.dataset.day);renderPlan()});
dailyPlan.addEventListener("click",event=>{const button=event.target.closest("[data-ingredient]");if(!button)return;state.query=button.dataset.ingredient;elements.searchInput.value=state.query;switchView("prices");render();setTimeout(()=>elements.searchInput.scrollIntoView({behavior:"smooth",block:"center"}),250)});
document.getElementById("newPlan").addEventListener("click",()=>{if(!nutritionPlan)return;nutritionPlan=createPlan(nutritionPlan.profile,(nutritionPlan.offset||0)+1);localStorage.setItem(planKey,JSON.stringify(nutritionPlan));renderPlan()});
document.getElementById("printPlan").addEventListener("click",()=>window.print());
document.getElementById("clearProfile").addEventListener("click",()=>{localStorage.removeItem(profileKey);localStorage.removeItem(planKey);profileForm.reset();nutritionPlan=null;planPanel.hidden=true});

try{
  const savedProfile=JSON.parse(localStorage.getItem(profileKey));if(savedProfile)fillProfile(savedProfile);
  nutritionPlan=JSON.parse(localStorage.getItem(planKey));if(nutritionPlan){if(!nutritionPlan.weeklyCost)nutritionPlan=createPlan(nutritionPlan.profile,nutritionPlan.offset||0);renderPlan()}
}catch{localStorage.removeItem(profileKey);localStorage.removeItem(planKey)}

function familyProfileFromForm(){
  const values=Object.fromEntries(new FormData(familyForm).entries());
  return {...values,scope:"family",goal:"maintain",age:"35",sex:"female",height:"160",weight:"58",activity:"1.375"};
}
function fillFamilyProfile(profile){Object.entries(profile||{}).forEach(([key,value])=>{if(familyForm.elements[key])familyForm.elements[key].value=value})}
function renderFamilyPlan(){
  if(!familyPlan)return;
  const names=["Thứ 2","Thứ 3","Thứ 4","Thứ 5","Thứ 6","Thứ 7","Chủ nhật"];
  const labels=familyPlan.profile.meals==="4"?["Bữa sáng","Bữa trưa","Bữa tối","Bữa phụ"]:["Bữa sáng","Bữa trưa","Bữa tối"];
  document.getElementById("familySize").textContent=familyPlan.householdSize;
  document.getElementById("familyDailyCost").textContent=Math.round((familyPlan.dayCosts[familyActiveDay]||0)/1000)+"k";
  document.getElementById("familyWeeklyCost").textContent=Math.round(familyPlan.weeklyCost/1000)+"k";
  document.getElementById("familyDayTabs").innerHTML=names.map((name,index)=>`<button class="day-tab ${index===familyActiveDay?'active':''}" type="button" role="tab" aria-selected="${index===familyActiveDay}" data-family-day="${index}">${name}</button>`).join("");
  const budgetMessage=familyPlan.weeklyCost<=familyPlan.budgetLimitWeek?`Nằm trong ngân sách ${money.format(familyPlan.budgetLimitWeek)} mỗi tuần.`:`Dự kiến vượt ngân sách ${money.format(familyPlan.weeklyCost-familyPlan.budgetLimitWeek)}. Hãy chọn phong cách tiết kiệm, 3 bữa hoặc tăng ngân sách.`;
  document.getElementById("familyDailyPlan").innerHTML=familyPlan.days[familyActiveDay].map((meal,index)=>`<article class="meal-row"><header><h3>${labels[index]}</h3><span class="meal-calories">≈ ${meal.adjustedKcal} kcal mỗi người</span></header><p><strong>${escapeHtml(meal.name)}</strong><br>${escapeHtml(meal.ingredients)} · cho ${familyPlan.householdSize} người</p><div class="meal-quantities">${meal.adjustedItems.map(item=>`<span>${escapeHtml(item[0])}: <strong>${item[1]} ${escapeHtml(item[2])}</strong></span>`).join("")}<span class="meal-cost">Chi phí cả nhà: ${money.format(meal.adjustedCost)}</span></div><button class="ingredient-search" type="button" data-ingredient="${escapeHtml(meal.search)}">Tìm giá ${escapeHtml(meal.search)}</button></article>`).join("")+`<p class="plan-note"><strong>${budgetMessage}</strong> ${familyPlan.profile.familyNotes?`Ghi chú: ${escapeHtml(familyPlan.profile.familyNotes)}. `:""}Trẻ nhỏ, người cao tuổi hoặc thành viên có bệnh nền có thể cần khẩu phần riêng.</p>`;
  const shopping=new Map();familyPlan.days.flat().forEach(meal=>meal.adjustedItems.forEach(([name,amount,unit])=>{const key=`${name}|${unit}`;const current=shopping.get(key)||{name,amount:0,unit};current.amount+=amount;shopping.set(key,current)}));
  document.getElementById("familyShoppingList").innerHTML=[...shopping.values()].sort((a,b)=>a.name.localeCompare(b.name,"vi")).map(item=>`<div class="shopping-item"><strong>${escapeHtml(item.name)}</strong><span>${Math.round(item.amount)} ${escapeHtml(item.unit)} mỗi tuần</span></div>`).join("");
  familyPlanPanel.hidden=false;
}
familyForm.addEventListener("submit",event=>{event.preventDefault();const profile=familyProfileFromForm();localStorage.setItem(familyKey,JSON.stringify(profile));familyPlan=createPlan(profile,0);localStorage.setItem(familyPlanKey,JSON.stringify(familyPlan));familyActiveDay=0;renderFamilyPlan();const saved=document.getElementById("familySaved");saved.hidden=false;setTimeout(()=>saved.hidden=true,1800);familyPlanPanel.scrollIntoView({behavior:"smooth",block:"start"})});
document.getElementById("familyDayTabs").addEventListener("click",event=>{const button=event.target.closest("[data-family-day]");if(!button)return;familyActiveDay=Number(button.dataset.familyDay);renderFamilyPlan()});
document.getElementById("familyDailyPlan").addEventListener("click",event=>{const button=event.target.closest("[data-ingredient]");if(!button)return;state.query=button.dataset.ingredient;elements.searchInput.value=state.query;switchView("prices");render()});
document.getElementById("newFamilyPlan").addEventListener("click",()=>{if(!familyPlan)return;familyPlan=createPlan(familyPlan.profile,(familyPlan.offset||0)+1);localStorage.setItem(familyPlanKey,JSON.stringify(familyPlan));renderFamilyPlan()});
document.getElementById("printFamilyPlan").addEventListener("click",()=>window.print());
document.getElementById("clearFamily").addEventListener("click",()=>{localStorage.removeItem(familyKey);localStorage.removeItem(familyPlanKey);familyForm.reset();familyPlan=null;familyPlanPanel.hidden=true});
try{const savedFamily=JSON.parse(localStorage.getItem(familyKey));if(savedFamily)fillFamilyProfile(savedFamily);familyPlan=JSON.parse(localStorage.getItem(familyPlanKey));if(familyPlan)renderFamilyPlan()}catch{localStorage.removeItem(familyKey);localStorage.removeItem(familyPlanKey)}

const chatKey="gia-tot-chat-history-v1";
const chatLauncher=document.getElementById("chatLauncher");
const chatPanel=document.getElementById("chatPanel");
const chatMessages=document.getElementById("chatMessages");
const chatInput=document.getElementById("chatInput");
let chatHistory=[];

function openChat(open=true){chatPanel.hidden=!open;chatLauncher.setAttribute("aria-expanded",String(open));if(open)setTimeout(()=>chatInput.focus(),50)}
function chatTime(){return new Date().toLocaleTimeString("vi-VN",{hour:"2-digit",minute:"2-digit"})}
function addChatMessage(role,text,save=true){
  const message={role,text,time:chatTime()};chatHistory.push(message);
  const node=document.createElement("div");node.className=`chat-message ${role}`;node.textContent=text;
  const time=document.createElement("time");time.textContent=message.time;node.append(time);chatMessages.append(node);
  chatMessages.scrollTop=chatMessages.scrollHeight;
  if(save)localStorage.setItem(chatKey,JSON.stringify(chatHistory.slice(-30)));
}
function currentProfile(){try{return JSON.parse(localStorage.getItem(profileKey))}catch{return null}}
function currentFamilyProfile(){try{return JSON.parse(localStorage.getItem(familyKey))}catch{return null}}
function currentTargets(profile){try{return profile?calculateTargets(profile):null}catch{return null}}
const ingredientAlternatives={
  "yến mạch":["khoai lang","bánh mì","gạo lứt","chuối"],
  "cá hồi":["cá basa","cá thu","ức gà","trứng gà"],
  "ức gà":["trứng gà","đậu hũ","thịt nạc heo","cá"],
  "thịt bò":["thịt nạc heo","ức gà","trứng gà","đậu hũ"],
  "sữa chua":["sữa tươi","chuối","trứng gà"],
  "gạo lứt":["gạo","khoai lang","bún"],
  "đậu hũ":["trứng gà","đậu nành","ức gà"],
  "sữa tươi":["sữa đậu nành","sữa chua","trứng gà"]
};
function ingredientMention(text){return Object.keys(ingredientAlternatives).find(item=>text.includes(normalize(item)))||["trứng gà","khoai lang","bánh mì","chuối","cá","thịt heo","sữa"].find(item=>text.includes(normalize(item)))}
function cheapestProduct(query){
  const normalized=normalize(query),tokens=normalized.split(" ").filter(Boolean);
  const blocked=["sua tam","dau goi","kem duong","mat na","bot mi","snack","say kho"];
  return state.products.filter(product=>{
    const name=product.normalized_name||normalize(product.name),category=normalize(product.category);
    if(!tokens.every(token=>name.includes(token))||Number(product.actual_price)<=0||blocked.some(word=>name.includes(word)||category.includes(word)))return false;
    if(normalized==="yen mach"&&!name.startsWith("yen mach"))return false;
    if(normalized==="khoai lang"&&!name.startsWith("khoai lang"))return false;
    if(normalized==="banh mi"&&!name.startsWith("banh mi"))return false;
    return true;
  }).sort((a,b)=>(a.unit_price??a.actual_price)-(b.unit_price??b.actual_price))[0]||null;
}
function priceText(query){const product=cheapestProduct(query);return product?`${product.name} tại ${product.supermarket==="winmart"?"WinMart":"Bách Hóa Xanh"}, ${money.format(product.actual_price)}${product.size?` cho ${product.size}`:""}`:null}
function substitutionReply(ingredient){
  const alternatives=(ingredientAlternatives[ingredient]||["trứng gà","đậu hũ","khoai lang"]).map(name=>({name,price:priceText(name)}));
  const available=priceText(ingredient);
  const listed=alternatives.slice(0,3).map(item=>item.price?`${item.name} (${item.price})`:item.name).join("; ");
  return `${available?`Tôi tìm thấy ${available}.`: `Hiện danh mục chưa tìm thấy kết quả rõ ràng cho ${ingredient}.`} Nếu giá chưa phù hợp, bạn có thể thay bằng ${listed}. Khi thay, hãy giữ khẩu phần có năng lượng tương đương và ưu tiên lựa chọn phù hợp với dị ứng đã khai báo.`;
}
function agentReply(raw){
  const text=normalize(raw),profile=currentProfile(),targets=currentTargets(profile);
  const ingredient=ingredientMention(text);
  if(/gia dinh|ca nha|vo chong|con nho|tre em|nguoi lon/.test(text)){
    const family=currentFamilyProfile();
    if(family)return `Tôi đang quản lý kế hoạch cho ${Number(family.adults||0)+Number(family.children||0)+Number(family.seniors||0)} người, với ngân sách ${money.format(Number(family.budget||0))} ${family.budgetPeriod==="day"?"mỗi ngày":"mỗi tuần"}. Bạn có thể hỏi tôi đổi món, giảm chi phí hoặc tìm giá nguyên liệu cho cả nhà.`;
    return "Bạn hãy mở mục Bữa ăn gia đình, nhập số người lớn, trẻ em, người cao tuổi và ngân sách chung. Tôi sẽ tính khẩu phần, chi phí và danh sách mua cho cả tuần.";
  }
  if(ingredient&&/(thay|the|khac|dat|cao|khong co|kha dung|con hang|tim thay)/.test(text))return substitutionReply(ingredient);
  if(ingredient&&/(gia|mua|tim)/.test(text)){const found=priceText(ingredient);return found?`Tôi tìm thấy ${found}. Bạn có thể mở phần So sánh giá để xem thêm lựa chọn và giá theo đơn vị.`:`Tôi chưa tìm thấy ${ingredient} trong danh mục hiện tại. Có thể sản phẩm đang dùng tên khác hoặc chưa được cửa hàng nguồn cập nhật.`}
  if(/xin chao|chao|hello|hi\b/.test(text))return "Chào bạn. Tôi có thể giúp lập thực đơn, tính nhu cầu năng lượng tham khảo hoặc tìm giá nguyên liệu. Bạn đang muốn giảm cân, tăng cân hay giữ cân?";
  if(/ho so|thong tin|can nang|chieu cao/.test(text))return profile?`Tôi đang dùng hồ sơ: ${profile.weight} kg, ${profile.height} cm, mục tiêu ${goalLabel(profile.goal).toLowerCase()}. Mức tham khảo hiện tại là khoảng ${targets.calories.toLocaleString("vi-VN")} kcal và ${targets.protein} g protein mỗi ngày.`:"Bạn chưa có hồ sơ. Hãy mở mục Trợ lý dinh dưỡng, nhập chiều cao, cân nặng, tuổi và mục tiêu rồi bấm Tạo kế hoạch 7 ngày.";
  if(/giam can/.test(text))return profile?`Với hồ sơ đã lưu, kế hoạch giảm cân tham khảo là khoảng ${calculateTargets({...profile,goal:"lose"}).calories.toLocaleString("vi-VN")} kcal mỗi ngày. Nên ưu tiên rau, đạm nạc, ngũ cốc nguyên hạt và theo dõi tiến độ thay vì cắt giảm quá nhanh.`:"Để tư vấn phù hợp hơn, tôi cần tuổi, giới tính, chiều cao, cân nặng và mức vận động. Bạn hãy điền hồ sơ trong mục Trợ lý dinh dưỡng.";
  if(/tang can/.test(text))return profile?`Mục tiêu tăng cân tham khảo của bạn là khoảng ${calculateTargets({...profile,goal:"gain"}).calories.toLocaleString("vi-VN")} kcal mỗi ngày. Có thể tăng khẩu phần cơm, khoai, sữa, trứng và nguồn đạm, đồng thời duy trì vận động sức mạnh.`:"Hãy nhập hồ sơ để tôi ước tính mức năng lượng tăng cân phù hợp hơn.";
  if(/giu can/.test(text))return profile?`Để giữ cân, mức tham khảo của bạn là khoảng ${calculateTargets({...profile,goal:"maintain"}).calories.toLocaleString("vi-VN")} kcal mỗi ngày. Hãy theo dõi cân nặng 2–3 tuần và điều chỉnh khẩu phần nếu có thay đổi rõ rệt.`:"Hãy nhập hồ sơ để tôi tính mức năng lượng giữ cân tham khảo.";
  if(/hom nay|bua an|thuc don|an gi/.test(text)){
    if(nutritionPlan){const meals=nutritionPlan.days[0].map(meal=>meal.name).join("; ");return `Gợi ý hôm nay: ${meals}. Bạn có thể mở Trợ lý dinh dưỡng để xem khẩu phần và năng lượng từng bữa.`}
    return "Tôi chưa có kế hoạch của bạn. Hãy điền hồ sơ và bấm Tạo kế hoạch 7 ngày; sau đó tôi sẽ dùng kế hoạch đó trong cuộc trò chuyện.";
  }
  if(/protein|dam|thit|ca|trung/.test(text))return "Các lựa chọn giàu protein dễ tìm gồm trứng, ức gà, cá, thịt nạc, sữa chua và đậu hũ. Bạn có thể nói rõ ngân sách hoặc nguyên liệu muốn thay, ví dụ “cá hồi đắt, thay bằng gì?”.";
  if(/gia|mua|tim/.test(text))return "Bạn hãy cho tôi tên nguyên liệu cụ thể, ví dụ “tìm giá trứng gà” hoặc “mua ức gà”. Tôi sẽ chuyển sang danh sách so sánh giá.";
  if(/di ung|tranh|khong an/.test(text))return "Bạn có thể ghi các thực phẩm cần tránh trong hồ sơ, ngăn cách bằng dấu phẩy. Hệ thống sẽ loại những món có từ khóa trùng khớp khi tạo kế hoạch mới.";
  return "Tôi chưa hiểu rõ câu hỏi. Bạn có thể hỏi: “Tôi muốn giảm cân”, “Gợi ý bữa ăn hôm nay”, “Hồ sơ của tôi” hoặc “Tìm giá trứng gà”.";
}
function maybeSearchFromChat(raw){
  const text=normalize(raw);if(!/(tim|mua|gia|protein|dam)/.test(text))return;
  const found=ingredientMention(text)||(text.includes("protein")||text.includes("dam")?"trứng gà":null);
  if(found){state.query=found;elements.searchInput.value=found;render()}
}
function sendChat(raw){const value=raw.trim();if(!value)return;addChatMessage("user",value);chatInput.value="";maybeSearchFromChat(value);setTimeout(()=>addChatMessage("agent",agentReply(value)),350)}

chatLauncher.addEventListener("click",()=>openChat(chatPanel.hidden));
document.getElementById("closeChat").addEventListener("click",()=>openChat(false));
document.getElementById("chatForm").addEventListener("submit",event=>{event.preventDefault();sendChat(chatInput.value)});
document.getElementById("chatSuggestions").addEventListener("click",event=>{const button=event.target.closest("[data-message]");if(button)sendChat(button.dataset.message)});
try{chatHistory=JSON.parse(localStorage.getItem(chatKey))||[]}catch{chatHistory=[]}
if(chatHistory.length){const previous=[...chatHistory];chatHistory=[];previous.forEach(message=>addChatMessage(message.role,message.text,false))}
else{
  addChatMessage("agent","Chào bạn, tôi là trợ lý dinh dưỡng của Giá Tốt. Tôi có thể lập thực đơn theo mục tiêu và giúp tìm nguyên liệu có giá phù hợp.");
  setTimeout(()=>openChat(true),700);
}
