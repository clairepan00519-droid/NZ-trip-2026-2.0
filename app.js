/* ============ 家人即時共享同步（Supabase，選用功能，免信用卡）============
   這個網頁預設仍是純前端靜態頁面，資料只存在「這台裝置的這個瀏覽器」。
   若想讓一起旅行的家人打開同一個網址，就能「即時」看到你新增的筆記、
   照片、自訂景點等內容（不用重新整理頁面），請照以下步驟啟用：

   1. 前往 https://supabase.com，用 Email 或 GitHub/Google 帳號免費註冊
      （完全不需要信用卡）。
   2. 建立一個新專案（New Project）：取名任意、資料庫密碼隨意設定
      （記下來備用）、地區選離你近的（如 Southeast Asia / Northeast Asia）。
      建立大約需要1-2分鐘等它初始化完成。
   3. 左側選單「SQL Editor」→「New query」，貼上下面這段 SQL 後按 Run，
      會建立好需要的資料表，並開啟即時同步(Realtime)：

        create table nz_sync (
          key text primary key,
          value text not null,
          updated_at timestamptz default now()
        );
        alter table nz_sync enable row level security;
        create policy "public read" on nz_sync for select using (true);
        create policy "public write" on nz_sync for insert with check (true);
        create policy "public update" on nz_sync for update using (true);
        alter publication supabase_realtime add table nz_sync;

      （這代表只要知道你的專案網址與金鑰就能讀寫，適合僅供親友使用的
      小型行程網頁；請不要把真正機密的資料放進這個共用資料表。）
   4. 左側選單「Project Settings」（齒輪圖示）→「Data API」，會看到
      「Project URL」；再到「API Keys」分頁，複製 anon / public 這把金鑰
      （新版介面可能標示為 publishable key）。
   5. 把這兩個值，分別貼到下面 SUPABASE_URL 和 SUPABASE_ANON_KEY，
      取代 null。存檔後重新上傳到你原本放這個網頁的地方
      （GitHub Pages／Netlify等）。

   沒有設定 SUPABASE_URL / SUPABASE_ANON_KEY 的話，以下程式會自動跳過
   雲端同步，網頁維持純本機模式，其他功能完全不受影響。
   =================================================================== */
const SUPABASE_URL = "https://xkahhddatpoxuembeiwl.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhrYWhoZGRhdHBveHVlbWJlaXdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ0NDExNDksImV4cCI6MjEwMDAxNzE0OX0.Jdpxpz7rgyK_OikYkRrVQComDWZiaI4fgf5ZV_SdaII";
/* 範例：
const SUPABASE_URL = "https://abcdefghijk.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9......";
*/

const cloudSync = { enabled:false, client:null, applyingRemote:false, pending:{}, timer:null };

(function initCloudSync(){
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || typeof supabase === 'undefined') return;
  try {
    cloudSync.client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    cloudSync.enabled = true;
    loadInitialCloudData();
    startCloudListening();
    updateSyncStatus();
  } catch(e) {
    console.error('Supabase 初始化失敗，將維持本機模式：', e);
  }
})();

/* 頁面剛打開時，先把雲端目前的最新資料整批抓下來套用一次
   （避免要等第一筆變更發生才會同步） */
async function loadInitialCloudData(){
  if (!cloudSync.enabled) return;
  try {
    const { data, error } = await cloudSync.client.from('nz_sync').select('key, value');
    if (error) throw error;
    (data || []).forEach(row => {
      cloudSync.applyingRemote = true;
      try { localStorage.setItem(row.key, row.value); } catch(e) { /* 本機空間已滿也沒關係，記憶體變數仍會更新 */ }
      applyStoreUpdate(row.key, row.value);
      cloudSync.applyingRemote = false;
    });
  } catch(e) {
    console.error('讀取雲端初始資料失敗：', e);
    updateSyncStatus(e);
  }
}

/* 監聽雲端資料變化：家人那端新增/修改任何東西，這台裝置會即時收到並更新畫面 */
function startCloudListening(){
  if (!cloudSync.enabled) return;
  cloudSync.client
    .channel('nz_sync_changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'nz_sync' }, (payload) => {
      const row = payload.new && Object.keys(payload.new).length ? payload.new : payload.old;
      if (!row || typeof row.value === 'undefined') return;
      cloudSync.applyingRemote = true;
      try { localStorage.setItem(row.key, row.value); } catch(e) { /* 本機空間已滿也沒關係，記憶體變數仍會更新 */ }
      applyStoreUpdate(row.key, row.value);
      cloudSync.applyingRemote = false;
      updateSyncStatus();
    })
    .subscribe((status, err) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { console.error('雲端同步監聽失敗：', err); updateSyncStatus(err || true); }
      else if (status === 'SUBSCRIBED') { updateSyncStatus(); }
    });
}

/* 把某個 nz_ 開頭的 key 的最新資料，套用回對應的記憶體變數並重新渲染畫面，
   讓家人那端不用重新整理頁面就能看到剛新增的筆記／照片／清單內容 */
function applyStoreUpdate(key, jsonStr){
  let parsed;
  try { parsed = JSON.parse(jsonStr); } catch(e) { console.error('套用雲端資料失敗：', key, e); return; }
  switch(key){
    case 'nz_notes': notesStore = parsed; break;
    case 'nz_photos': photoStore = parsed; break;
    case 'nz_covers': coverStore = parsed; break;
    case 'nz_custom_spots': customSpotsStore = parsed; break;
    case 'nz_order': orderStore = parsed; break;
    case 'nz_block_order': blockOrderStore = parsed; break;
    case 'nz_route_maps': routeMapStore = parsed; break;
    case 'nz_pack': packData = parsed; if (typeof renderPackList === 'function') renderPackList(); return;
    case 'nz_shop': shopData = parsed; if (typeof renderShopList === 'function') renderShopList(); return;
    case 'nz_rules': rulesData = parsed; if (typeof renderRulesList === 'function') renderRulesList(); return;
    case 'nz_docs': docsData = parsed; if (typeof renderDocsList === 'function') renderDocsList(); return;
    default: return;
  }
  if (typeof renderDayContent === 'function') renderDayContent();
  if (typeof updateSpotCount === 'function') updateSpotCount();
}

/* 把本機剛寫入的資料推上雲端，讓家人即時看到。用簡單防抖（600ms），
   避免使用者連續操作（例如一次選很多張照片）時狂打寫入次數 */
function scheduleCloudPush(key, valueObj){
  if (!cloudSync.enabled || cloudSync.applyingRemote) return;
  cloudSync.pending[key] = valueObj;
  clearTimeout(cloudSync.timer);
  cloudSync.timer = setTimeout(flushCloudPush, 600);
}
async function flushCloudPush(){
  const entries = Object.entries(cloudSync.pending);
  cloudSync.pending = {};
  for (const [key, valueObj] of entries) {
    try {
      const { error } = await cloudSync.client.from('nz_sync').upsert({
        key,
        value: JSON.stringify(valueObj),
        updated_at: new Date().toISOString()
      });
      if (error) throw error;
    } catch(e) {
      console.error('雲端同步寫入失敗：', key, e);
      alert('⚠️ 剛才的變更同步到家人共享雲端時失敗（可能是網路不穩，或資料量太大）。這台裝置上的資料仍已保留。');
      updateSyncStatus(e);
    }
  }
}
function updateSyncStatus(err){
  const el = document.getElementById('cloudSyncStatus');
  if (!el) return;
  if (!cloudSync.enabled) { el.style.display = 'none'; return; }
  el.style.display = 'inline-flex';
  el.classList.toggle('sync-error', !!err);
  el.textContent = err ? '⚠️ 雲端連線異常' : '☁️ 家人共享同步中';
}

/* ============ HEADER IMAGES ============ */
const headerBgs = [
  {url:'https://redwhiteadventures.com/wp-content/uploads/2025/07/Pukaki-Kettle-Hole-Track-Mount-Cook-New-Zealand-15.webp', pos:'center 55%'},
  {url:'https://www.outsidesports.co.nz/cdn/shop/articles/church-of-good-shepherd-new-zealand-m8y3_2239x.webp?v=1765414174', pos:'center 60%'},
  {url:'https://www.earthtrekkers.com/wp-content/uploads/2023/11/Hooker-Valley-Track-Trail-Guide.jpg.optimal.jpg', pos:'center 45%'},
  {url:'https://queenstown.skyline.co.nz/cdn-cgi/image/quality=75,width=1920,height=1080,f=auto,fit=cover/https://media.skyline.co.nz/queenstown/media/uploads/2023/11/12135919/Skyline-Queenstown_Gondola_Remarkables_M.png', pos:'center 50%'},
  {url:'https://content.api.news/v3/images/bin/50c842e054f4428876bf516da4af98db', pos:'center 40%'}
];
document.addEventListener('DOMContentLoaded', () => {
  const pick = headerBgs[Math.floor(Math.random() * headerBgs.length)];
  const header = document.getElementById('main-header');
  header.style.backgroundImage = `linear-gradient(180deg, rgba(83,129,236,0.25) 0%, rgba(47,58,74,0.75) 100%), url('${pick.url}')`;
  header.style.backgroundPosition = pick.pos;
});

function loadLocalMap(e){
  const f = e.target.files[0];
  if(f){
    document.getElementById('handDrawnMapImg').src = URL.createObjectURL(f);
    document.getElementById('handDrawnMapImg').style.display = 'block';
    document.getElementById('mapFallback').style.display = 'none';
  }
}

/* ============ DATA ============ */
const CAT = {
  food:{label:'美食', cls:'cat-food', emoji:'🍽️'},
  activity:{label:'活動／步道', cls:'cat-activity', emoji:'🥾'},
  shopping:{label:'購物', cls:'cat-shopping', emoji:'🛍️'},
  attraction:{label:'景點', cls:'cat-attraction', emoji:'🏞️'},
  hotel:{label:'住宿', cls:'cat-hotel', emoji:'🏨'},
  transport:{label:'交通', cls:'cat-transport', emoji:'✈️'},
};

function S(name, cat, desc, opts={}){
  return Object.assign({name, cat, desc, tags:[], park:null, tip:null, dur:null, note:null, link:null, linkLabel:'查看網頁', img:null, hours:null, docMap:null, customInfo:null, recDishes:null, fullDesc:null}, opts);
}

const days = [
{dayNum:'Flight', date:'9/11', weekday:'五', region:'啟程・飛向紐西蘭', enRegion:'Taipei → Auckland', drive:'✈️ 國際航班：飛行約 14 小時', title:'桃園機場出發，夜航直飛奧克蘭', dayDesc:'今晚從桃園機場搭乘華航班機經布里斯本前往奧克蘭，隔天（9/12）傍晚抵達後可於機場周邊或市區休息一晚，銜接隔天南島國內線。', wear:'機艙冷氣強，建議帶件薄毯', weatherIco:'✈️', spots:[S('CI53 TPE→BNE→AKL','transport','23:55桃園起飛，經布里斯本，隔日約18:25抵達奧克蘭。',{dur:'約14小時', fullDesc:'23:55 由桃園國際機場起飛，經布里斯本轉機，隔日（9/12）約18:25 抵達奧克蘭國際機場。建議提前報到，長程夜航準備頸枕。', img:'https://preview.redd.it/sunrise-from-the-window-of-my-transatlantic-flight-v0-j1b9ou28ou921.jpg?width=1080&crop=smart&auto=webp&s=3465eac9b4e9e804c4e6f7421a37b20420156988'})], moreSpots: []},
{dayNum:'1', date:'9/13', weekday:'日', region:'啟程・越嶺境', enRegion:'Queenstown → Wanaka', drive:'🚗 約 68 km / 1小時 10分', gas:'⛽ 取車後於 ZQN 或 Wanaka 加滿', title:'降落長白雲之鄉，初探 Lake Wanaka', dayDesc:'從 AKL 飛抵 Queenstown，越過 Cardrona Valley，以湖畔美景與經典漢堡拉開序幕', wear:'長袖＋防風外套，山區早晚偏涼', weatherIco:'⛅', spots:[
  S('NZ617 AKL→ZQN','transport','10:25由奧克蘭起飛，12:20抵達皇后鎮。',{dur:'約1小時55分', fullDesc:'10:25 由奧克蘭起飛，12:20 抵達皇后鎮機場，為 Air New Zealand 國內航班。全程航程約兩小時，高空俯瞰南阿爾卑斯山脈景致絕佳。', img:'https://content.r9cdn.net/rimg/dimg/4b/9f/755cbdd6-al-NZ-16713e9dd45.jpg?width=1366&height=768&crop=true'}), 
  S('Cardrona Valley Road','attraction','連接皇后鎮與瓦納卡的高山山谷公路。',{tags:['必拍'], fullDesc:'連接皇后鎮與瓦納卡的高山山谷公路（Crown Range Road），為紐西蘭海拔最高的常規公路。沿途高山草原開闊，秋末初春時遠方山頭微帶積雪，是明信片等級的景觀公路。開車時需注意陡坡與連續彎路。', tip:'可在高處官方觀景點停車，拍攝髮夾彎山路與河谷地形。順光時段（中午前後）色彩層次最迷人。', park:'沿線設有數個專屬避車彎觀景台，山路陡峭請確認拉好手煞車。', img:'https://www.newzealand.com/assets/Tourism-NZ/Queenstown/img-1536923687-3874-29271-3168459346_753fccfc0d_o__aWxvdmVrZWxseQo_FocalPointCropWzM1MiwxMDI0LDM1LDUwLDc1LCJqcGciLDY1LDIuNV0.jpg'}), 
  S('Lake Wanaka','attraction','紐西蘭第四大湖，清晨或傍晚湖面倒映雪山。',{tags:['必拍'], hours:'全天開放', fullDesc:'瓦納卡湖為紐西蘭第四大湖，景色比喧囂的皇后鎮更加開闊寧靜。清晨或傍晚時分，湖面宛如鏡面，可清晰倒映出遠方阿斯派林山國家公園的連綿雪山，非常適合沿著湖畔長廊悠閒漫步與攝影。', tip:'除了知名的「瓦納卡孤樹」，沿著湖畔木棧道往西走更能拍到無死角的雪山湖景。', img:'https://content.api.news/v3/images/bin/50c842e054f4428876bf516da4af98db'}), 
  S('Glendhu Bay Lookout','attraction','瓦納卡湖西側的絕美觀景點。夕陽西下金黃光芒灑在對岸。',{tags:['必拍'], fullDesc:'位於瓦納卡湖西側約 10 分鐘車程的絕美觀景點。相較於市區，這裡能以更正面的角度遠眺巍峨雪山與蜿蜒湖灣。夕陽西下時，金黃色的光芒會灑在對岸山頭上，是當地攝影師最推崇的日落拍攝地。', tip:'下午 4 點後前往，逆光或側光下的湖面波光與山脈陰影線條非常立體。', img:'https://d3fphkxyf5o5bm.cloudfront.net/image-resize/format=webp,w=1200/QwRY54Li1HMwD7oNfoY3bIdv6sxUH1ANEP7VlwASyZ'}), 
  S('Eely Point','activity','瓦納卡湖濱保護區。從市區沿湖畔步行20-30分鐘，當地人熱門的野餐與戲水地點。',{img:'https://cdn.prod.rexby.com/image/b1b9d56751184e86bdce2d7182c5216f?format=webp&width=1080&height=1350&quality=80', tags:['私房'],dur:'約40分鐘(來回)', fullDesc:'位於瓦納卡湖東南岸的湖濱保護區，從市區沿 Lakeside Road 步行約20-30分鐘即可抵達，是當地居民熱門的野餐、划船與戲水去處，比熱鬧的市區湖濱更加悠閒。這裡因過去湖中盛產長鰭鰻（eel）而得名，沿岸設有草坪、卵石灘與野餐設施，天氣好時可遠眺阿斯派林山國家公園群峰倒映在湖面上。繼續往北走還能連接 Beacon Point 步道。'}), 
  ], 
  moreSpots: [
    S('機場周邊 Supermarket','shopping','落地後先在機場周邊的 Pak\'nSave 採買長途開車的水與零食。',{tags:['必買'], hours:'07:00–22:00', fullDesc:'落地後先在機場周邊的 Pak\'nSave 或 New World 大型超市採買長途開車的水、零食與自炊食材。因為隨後前進的瓦納卡、庫克山等山區物價較高且大賣場選擇較少，建議在此一次補齊。', img:'https://upload.wikimedia.org/wikipedia/commons/a/a5/Pak%27n_Save_Wanganui.JPG'}), 
    S('Burger Club','food','人氣美式漢堡，嚴選草飼牛，肉汁飽滿。', {tags:['必吃'], hours:'11:30–21:00', fullDesc:'位於瓦納卡市區的人氣美式漢堡店。嚴選紐西蘭優質草飼牛與在地新鮮蔬菜，外皮烤得酥脆、肉汁飽滿。份量極為紮實，是長途駕車後迅速補充體力的最佳選擇。', img:'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4d/Cheeseburger_with_fries.jpg/640px-Cheeseburger_with_fries.jpg', customInfo:'⚠️ 尖峰時段需排隊20分以上', recDishes:'黑松露蘑菇起司堡'}), 
    S('Wanaka Apartment','hotel','今日住宿。湖畔新建度假社區，附室內溫水泳池。',{link:'https://www.airbnb.com.tw/rooms/835936560022815796', linkLabel:'查看 Airbnb 房源', fullDesc:'位於瓦納卡湖畔新建度假社區，Superhost 評等4.97分，步行5分鐘可達市區。2房1床，附設施包含室內恆溫泳池、水療池與健身房（皆可眺望湖景），公寓內附全套廚房、壁爐、專屬車位及滑雪／單車置物櫃。', img:'https://a0.muscache.com/im/pictures/miso/Hosting-835936560022815796/original/dd4fb9bb-715a-426e-ab37-cea8697a0aae.jpeg?im_w=720'})]},
{dayNum:'2', date:'9/14', weekday:'一', region:'尋幽・鑽石光', enRegion:'Wanaka', drive:'🚗 單趟約 30 km / 40分', title:'漫步 Rocky Mountain，尋味法式晨光', dayDesc:'登高俯瞰 Diamond Lake 與 Wanaka 湖景，穿插在地知名烘焙坊', wear:'排汗長袖＋防風外套＋登山鞋', weatherIco:'🌤️', spots:[
  S('Diamond Lake & Rocky Mtn','activity','指標健行路線。陡升至山頂，可 360 度鳥瞰瓦納卡群山。',{tags:['必拍'],dur:'約2–3小時', hours:'全天開放', fullDesc:'瓦納卡指標性的徒步健行路線。步道極具層次感：第一階段為平緩的鑽石湖環線；第二階段上升至鑽石湖觀景台；最後陡升至 Rocky Mountain 山頂（海拔 775 公尺），可 360 度鳥瞰整片瓦納卡湖群山、克魯薩河谷及冰河地形遺跡。', tip:'若時間與體力允許，強烈建議直接攻頂 Rocky Mountain，攻頂段有多處土路與岩石，需穿著抓地力強的登山鞋。', park:'設有寬敞的免費專屬停車場，備有流動廁所。', docMap:'https://www.doc.govt.nz/parks-and-recreation/places-to-go/otago/places/wanaka-area/tracks/diamond-lake-and-rocky-mountain-tracks/', img:'https://images.hika.app/hikes/images/original/new-zealand/otago/diamond-lake-and-rocky-mountain-track.jpeg'}), 
  S('Upper Clutha River Track','activity','沿克魯薩河的平緩步道。沿途河水呈現剔透湛藍色。',{tags:['必拍'], hours:'全天開放', fullDesc:'沿著紐西蘭水量最大的河流——克魯薩河所建的平緩徒步/單車道。沿途河水呈現不可思議的剔透湛藍色，兩岸初春時林木漸綠，走起來平舒放鬆，能近距離欣賞純淨的河岸生態。', img:'https://www.newzealand.com/assets/Tourism-NZ/Wanaka/img-1536921212-6476-20360-p-719AD18A-EF0A-41E2-6B640C81E94AD5DF-2544003__ExtRewriteWyJwbmciLCJqcGciXQ_aWxvdmVrZWxseQo_CropResizeWzE5MDAsMTAwMCw3NSwianBnIl0.jpg'}), 
  S('Lake Hawea','attraction','瓦納卡姊妹湖，保留原始靜謐。湖水因深度更深呈深邃寶藍色。',{tags:['必拍'], fullDesc:'與瓦納卡湖僅一山之隔的姊妹湖，由於遊客大幅減少，這裡保留了更多原始與靜謐。哈威亞湖的湖水顏色因深度更深，呈現出更為深邃神祕的寶藍色，岸邊矗立著高聳的陡峭山壁，景致震撼。', img:'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQkT3XGOA0yxemYMlmNtUii05ezWaIeXaON-ZMXA4wQxQ&s=10'}), 
  S('Waterfall Creek Track','activity','沿瓦納卡湖西岸的平緩步道，途經知名孤樹與Rippon酒莊，終點可見Ruby Island。',{img:'https://i.pinimg.com/736x/b3/12/db/b312db188f1cfad692b2d7fecfe1607e.jpg', tags:['必拍'],dur:'約1.5小時(來回)', fullDesc:'從 Roys Bay 西側出發的平緩湖濱步道，全長約2.5公里、單趟約45分鐘，沿途會先經過舉世聞名的「瓦納卡孤樹」，接著行經 Rippon 酒莊，最後抵達 Waterfall Creek，可遠眺湖中的 Ruby Island。步道平坦好走，適合推嬰兒車或親子同行，也可以延伸騎乘單車前往更遠的 Glendhu Bay。'}), 
  ], 
  moreSpots: [
    S('Pembroke Patisserie','food','傳奇法式烘焙坊。可頌與水果塔極具盛名。', {tags:['必吃'], hours:'08:00–14:00 (一二休)', fullDesc:'位於瓦納卡近郊小鎮 Albert Town 的傳奇法式烘焙坊。其傳統法式可頌、杏仁可頌與各式精緻水果塔在南島極具盛名，配上一杯香醇的白咖啡（Flat White），是健行後最完美的下午茶享受。', customInfo:'這間店常常大排長龍，建議早點出發以免品項賣光！', img:'https://www.pembrokepatisserie.co.nz/wp-content/uploads/2020/04/pembroke-patisserie-wanaka-catering-selection-sweet.jpg', recDishes:'法式杏仁可頌、卡士達塔'}), 
    S('Charlie Brown Crepes','food','餐車廣場的法式可麗餅專賣店。現點現做，口味豐富。',{tags:['必吃'], hours:'09:00–20:00', fullDesc:'藏身於市區美食餐車廣場的法式可麗餅專賣店。主打現點現做的法式薄餅，不論是經典的焦糖蘋果、榛果可可甜口味，或者是融入紐西蘭起司與培根的鹹口味，都充滿濃郁的手作溫度。', img:'https://i0.wp.com/charliebrowncrepes.co.nz/wp-content/uploads/2025/10/Home_Top7-scaled.jpg?fit=2048%2C2560&ssl=1', recDishes:'焦糖蘋果薄餅'}), 
    S('Muttonbird','food','創意歐陸與當代料理，擺盤如藝術品。',{tags:['必吃'], hours:'17:00–22:00', note:'強烈建議提前訂位', fullDesc:'主打創意歐陸與紐西蘭當代料理，餐點精緻且擺盤如藝術品，經常客滿需訂位。', img:'https://neatplaces.co.nz/cdn-cgi/image/format=auto,fit=cover,height=425,width=650//media/uploads/places/place/muttonbird/Muttonbird_-_WANAKA_38.jpg', recDishes:'季節分享盤'}), 
    S('Francesca\'s Italian Kitchen','food','在地義式料理南霸天，柴燒窯烤披薩深受好評。',{tags:['必吃'], hours:'12:00–21:30', note:'強烈建議提前訂位', fullDesc:'當地的義式料理南霸天，其柴燒窯烤披薩與手工馬鈴薯麵疙瘩（Gnocchi）深受好評。', img:'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSS731UYBbmKVTXwzc3EKXsExogqT3mMTBXYGYei5MP_-lBk1ayHj9CoQM&s=10', recDishes:'木柴窯烤披薩、手工麵疙瘩'}), 
    S('Wanaka Apartment','hotel','連住第二晚。',{link:'https://www.airbnb.com.tw/rooms/835936560022815796', linkLabel:'查看 Airbnb 房源', fullDesc:'連住第二晚。房東 Shaun 為 Superhost，如需將床型改為兩張大床請提前聯繫房東安排清潔調整。', img:'https://a0.muscache.com/im/pictures/miso/Hosting-835936560022815796/original/dd4fb9bb-715a-426e-ab37-cea8697a0aae.jpeg?im_w=720'})]},
{dayNum:'3', date:'9/15', weekday:'二', region:'越境・染星穹', enRegion:'Wanaka → Lake Tekapo', drive:'🚗 約 200 km / 2.5小時', gas:'⛽ 途經 Twizel 於 NPD 加滿', title:'穿梭 Lindis Pass，Tekapo 星光', dayDesc:'伴隨薰衣草香與鮮美鮭魚，越過壯麗隘口，迎接無垠星空', wear:'保暖外套＋圍巾，風大氣溫低', weatherIco:'⛅', spots:[
  S('Wānaka Lavender Farm','attraction','在地薰衣草農場。設有花園、茶室，能近距離餵食草泥馬。',{tags:['必拍'], hours:'10:00–17:00', note:'春季門票約 $7 NZD', fullDesc:'佔地寬廣的在地薰衣草農場。雖然 9 月初春尚未進入紫色花海盛開期，但農場內設有精緻的鄉村花園、茶室，並販售純正的薰衣草精油商品、蜂蜜冰淇淋，還能近距離餵食草泥馬和小羊。', img:'https://static.wixstatic.com/media/5f2212_06583104873f4f998bf34cdc09229658~mv2.jpg/v1/fill/w_568,h_380,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/5f2212_06583104873f4f998bf34cdc09229658~mv2.jpg'}), 
  S('Lindis Pass','attraction','連接奧塔哥與麥肯齊盆地的高山通道，擁有惡地金黃丘陵地形。',{tags:['必拍'], fullDesc:'連接奧塔哥與麥肯齊盆地的著名高山山口通道（海拔達 971 公尺）。這裡擁有極為獨特的惡地丘陵地形，山上覆蓋著金黃色的草本植物（Tussock），在陽光照射下會呈現如絲綢般的光影線條，冬天與初春時則可能覆蓋白雪，壯麗非凡。', tip:'山頂風大且氣溫驟降，下車記得穿大衣。官方觀景台設有一段短步道可爬上小山丘。', park:'山口最高點設有專屬免費停車場。', img:'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQn22Xamf2PRFoVYt6rOfa_B9cUB3LwDglLx3WZgyimAGkn98eiFGdR2xWw&s=10'}), 
  S('Lake Tekapo','attraction','麥肯齊盆地的明珠。夢幻「土耳其藍」湖水與牧羊人教堂。',{tags:['必拍'], fullDesc:'麥肯齊盆地的明珠。蒂卡波湖最著名的是其夢幻般的「土耳其藍」湖水，這是因為冰河融水夾帶了大量的微細岩粉懸浮在水中。背景襯托著高聳的阿爾卑斯山脈，湖畔還有指標性的牧羊人教堂。', img:'https://www.outsidesports.co.nz/cdn/shop/articles/church-of-good-shepherd-new-zealand-m8y3_2239x.webp?v=1765414174'}), 
  S('Sunset Rock','attraction','蒂卡波當地人私藏的頂級日落觀景高地。',{tags:['必拍'], fullDesc:'蒂卡波當地人私藏的頂級日落觀景高地。位於小鎮後方的半山腰山頭，居高臨下，能同時將整片土耳其藍湖泊、牧羊人教堂以及背後整座被夕陽染成粉紅色的南阿爾卑斯雪山群峰盡收眼底。', tip:'建議在預計日落前 40 分鐘抵達。帶上相機腳架，用黃金光線拍攝牧羊人教堂與湖泊全景。', img:'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQTlto7cMN_62cjmkAztGVa_g2lwh4n8PIRcc1arYiwcw&s=10'}), 
  ], 
  moreSpots: [
    S('Scroggin Coffee','food','木質調文青咖啡館。主打健康在地早午餐。',{tags:['必吃'], hours:'07:00–14:30', fullDesc:'瓦納卡市區極具質感的木質調文青咖啡館。主打健康、在地食材的早午餐與自家烘焙精品豆，出發跨區長途自駕前補充能量的首選。', img:'https://www.scrogginwanaka.co.nz/cdn/shop/files/Scroggin-205.jpg?v=1725840972&width=600', recDishes:'酪梨吐司、自製烘焙燕麥'}), 
    S('High Country Salmon','food','高山鮭魚養殖場。可購買新鮮生魚片，戶外餵食鮭魚。',{tags:['必吃','必買'], hours:'09:00–17:00', fullDesc:'位於 Twizel 庫克山公路附近的冰河水高山鮭魚養殖場。肉質極度肥美緊實。可以現場購買超新鮮生魚片、鮭魚漢堡，還能走到戶外魚池免費拿飼料體驗餵食巨大的鮭魚。', img:'https://www.highcountrysalmon.co.nz/cdn/shop/files/Highcountry_Salmon-7542.jpg?v=1748402578&width=3840', recDishes:'鮭魚生魚片、漢堡'}), 
    S('Starview 88 - Tekapo','hotel','今晚住宿。落地窗直面蒂卡波湖與雪山。',{link:'https://www.agoda.com/zh-tw/starview-88/hotel/lake-tekapo-nz.html', linkLabel:'查看 Agoda 房源', fullDesc:'位於 Lochinver Rise 高處的現代度假宅，挑高客廳＋壁爐，落地窗直面蒂卡波湖與雪山，距湖畔步行約15分鐘、距小鎮車程約3分鐘，離今日行程的 Sunset Rock 觀景點僅約1.6公里。天氣晴朗時建議夜間留意星空。', img:'https://upload.wikimedia.org/wikipedia/commons/thumb/b/bf/Church_of_the_Good_Shepherd_Tekapo.jpg/640px-Church_of_the_Good_Shepherd_Tekapo.jpg'})]},
{dayNum:'4', date:'9/16', weekday:'三', region:'仰星・觀天象', enRegion:'Lake Tekapo', drive:'🚗 單趟約 10 km / 15分', title:'Mt John 宇宙之眼，Lake Alexandrina', dayDesc:'沉浸於天文台的星穹視角，並在隱秘湖畔捕捉最純淨的自然光影', wear:'防風外套＋保暖帽，山頂溫差大', weatherIco:'☀️', spots:[
  S('Mt John Summit Track','activity','環繞約翰山頂的景觀步道。擁有震撼的 360 度視角。',{tags:['必拍'],dur:'約2–3小時', fullDesc:'環繞約翰山頂的頂級景觀步道。山頂視野毫無遮蔽，擁有震撼的 360 度視角，可同時俯瞰碧藍的蒂卡波湖、寶藍的亞歷山德里納湖。', tip:'山頂完全暴露在風口中，即使是大晴天也往往狂風大作，防風防水外套、毛帽與太陽眼鏡為必備。', park:'步道口有免費停車場；若選擇開車上山頂需在山腳閘門支付道路使用費。', docMap:'https://www.doc.govt.nz/parks-and-recreation/places-to-go/canterbury/places/lake-tekapo-area/tracks/mount-john-summit-track/', img:'https://cdn.prod.rexby.com/image/9f8fa577cdd143059ad1f07343635b74?format=webp&width=1080&height=1350&quality=80'}), 
  S('Mt John Observatory','attraction','坎特伯里大學天文觀測台。夜間可觀星。',{tags:['必拍'], hours:'咖啡廳 09:00–15:00', note:'開車上山需收費', fullDesc:'坎特伯里大學設於紐西蘭的重要天文研究觀測台。由於蒂卡波屬於國際黑暗天空保護區，這裡擁有全紐西蘭最純淨、無光害的星空環境。夜間可報名參加專業觀星導覽。', img:'https://cloudfront-ap-southeast-2.images.arcpublishing.com/nzme/SBRRQJLB47WWHMFRG7BH3BPOS4.jpg'}), 
  S('Lake Alexandrina','attraction','蒂卡波湖旁的私房隱密湖泊。深邃寶藍色，嚴禁動力船進入。',{fullDesc:'距離蒂卡波湖僅約 15 分鐘車程的私房隱密湖泊。不同於蒂卡波湖的冰河懸浮土耳其藍，這座湖是純淨的地下泉水與雨水匯集，湖水呈深邃清透的寶藍色，嚴禁任何動力船隻進入，是尋求極致安寧的世外桃源。', img:'https://cdn.sanity.io/images/n1o990un/production/0bfb837ba10be9becbf00dda9b661028527416ac-1600x1200.jpg?auto=format&fit=max&w=3840'}), 
  ], 
  moreSpots: [
    S('The Greedy Cow Cafe','food','人氣溫馨早餐店。主打大份量英式傳統早餐與帕尼尼。',{tags:['必吃'], hours:'07:30–14:00', fullDesc:'蒂卡波小鎮上極受歡迎的溫馨早餐店。主打大份量的英式傳統早餐、香煎培根與現做帕尼尼。店內氣氛輕快，咖啡水準極高，是開啟一天步道行程的最佳起點。', img:'https://static.wixstatic.com/media/db1de0_39f47fad88b6491380d9b51bb9c94724~mv2.jpg/v1/fill/w_1920,h_1200,al_c,q_90/Greedy-Cow-Featured-Image-2.jpg', recDishes:'Big Breakfast、現做帕尼尼'}), 
    S('Starview 88 - Tekapo','hotel','連住第二晚。',{link:'https://www.agoda.com/zh-tw/starview-88/hotel/lake-tekapo-nz.html', linkLabel:'查看 Agoda 房源', fullDesc:'連住第二晚。2晚為最低住宿晚數要求，退房前記得 check-out 時間（通常上午10點前）。', img:'https://upload.wikimedia.org/wikipedia/commons/thumb/b/bf/Church_of_the_Good_Shepherd_Tekapo.jpg/640px-Church_of_the_Good_Shepherd_Tekapo.jpg'})]},
{dayNum:'5', date:'9/17', weekday:'四', region:'湛藍・雪之巔', enRegion:'Tekapo → Mt Cook', drive:'🚗 約 105 km / 1.5小時', title:'Lake Pukaki 蒂芬妮藍與庫克山', dayDesc:'品嚐高山鮭魚，沿著極致湛藍的湖畔公路，直抵雪山腳下', wear:'厚外套＋手套，山區可能低於0°C', weatherIco:'❄️', spots:[
  S('Lake Pukaki','attraction','最美冰河湖。牛奶藍湖水，天氣晴朗時可見庫克山主峰。',{tags:['必拍'], fullDesc:'被譽為全紐西蘭最美麗的冰河湖。普卡基湖的面積巨大，其標誌性的「牛奶藍」湖水顏色比蒂卡波湖更為濃郁迷人。天氣晴朗時，紐西蘭最高峰——海拔 3,724 公尺的庫克山主峰會端正地矗立在湖泊的正中央。', img:'https://redwhiteadventures.com/wp-content/uploads/2025/07/Pukaki-Kettle-Hole-Track-Mount-Cook-New-Zealand-15.webp'}), 
  S('Peter\'s Lookout','attraction','公路中途景觀台。拍攝南島經典「寂寞公路延伸至雪山」取景點。',{tags:['必拍'], fullDesc:'沿著普卡基湖西側通往庫克山村（Mount Cook Road）公路上的中途景觀台。這裡是拍攝南島經典「寂寞景觀公路延伸至遠方巍峨雪山」畫面最著名的取景點，能完美捕捉台地地形、牛奶藍湖水與庫克山主峰的比例。', park:'設有專屬的狹長形免費停車場', img:'https://www.weseektravel.com/wp-content/uploads/2020/04/PETERS-LOOKOUT-ROAD-TO-MOUNT-COOK-6570-e1623502991290.jpg'}), 
  S('Glentanner Lookout','attraction','國家公園邊界停靠點。宏偉的塔斯曼河谷沖積扇一覽無遺。',{tags:['必拍'], fullDesc:'接近庫克山國家公園邊界的大型路邊停靠景觀點。隨著車速推進，庫克山巨大的山體與冰河斷崖會逐漸在擋風玻璃前逼近放大，這裡視野開闊，能拍攝到廣闊的塔斯曼河谷沙洲沖積扇地形。', img:'https://cdn.prod.rexby.com/image/00230bda2de6470981e35f8aced19efd?format=webp&width=1080&height=1350&quality=80'}), 
  S('Kea Point','activity','平緩親民景觀步道。終點觀景台可俯瞰穆勒冰河湖。',{tags:['必拍'],dur:'來回約2小時', fullDesc:'庫克山國家公園內一條平緩、難度極低的親民景觀步道。從 White Horse Hill 停車場出發，沿著古老的冰磧平原前進，終點為木製觀景台。在此可居高臨下俯瞰穆勒冰河湖的灰色懸浮冰水，並近距離瞻仰庫克山主峰。', tip:'傍晚時分前來，有機會捕捉到夕陽將庫克山雪白山頭染成耀眼金紅色的「日照金山」奇景。', docMap:'https://www.doc.govt.nz/parks-and-recreation/places-to-go/canterbury/places/aoraki-mount-cook-national-park/tracks/kea-point-track/', img:'https://www.alpineluxurytours.co.nz/wp-content/uploads/2023/07/aoraki-mount-cook-hooker-valley-hike-1.jpg'}), 
  ], 
  moreSpots: [
    S('Mt Cook Salmon Shop','food','普卡基湖畔傳奇鮭魚店。吃現切生魚片眺望牛奶藍湖水。',{tags:['必吃','必買'], hours:'08:30–17:30', fullDesc:'坐落於普卡基湖畔的傳奇鮭魚店。這裡售賣的鮭魚是在海拔更高、水流更湍急的庫克山冰河渠道中養殖。肉質鮮甜毫無腥味。一邊坐在湖畔長椅吃著現切生魚片，一邊眺望藍色湖水與遠方的庫克山，是最頂級的享受。', img:'https://media-cdn.tripadvisor.com/media/photo-m/1280/14/e4/f9/be/mount-cook-alpine-salmon.jpg', recDishes:'高山冰河鮭魚生魚片'}), 
    S('Mt Cook Motels','hotel','今晚住宿，庫克山國家公園下村，附獨立廚房適合自炊。',{link:'https://www.hermitage.co.nz/stay/mt-cook-motels/', linkLabel:'查看房源官網', fullDesc:'今晚住宿，位於庫克山國家公園下村，距 Hermitage Hotel 約800公尺，附獨立廚房、客廳與戶外露台，適合自炊。提醒：5–9月期間須至 Hermitage Hotel 辦理入住。', img:'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d7/Lake_Pukaki_and_Mount_Cook.jpg/640px-Lake_Pukaki_and_Mount_Cook.jpg'})]},
{dayNum:'6', date:'9/18', weekday:'五', region:'履冰・踏雪賦', enRegion:'Mt Cook', drive:'🚗 單趟約 5 km / 10分', title:'步入冰河之境，Hooker Valley 史詩', dayDesc:'穿上冰爪挑戰冰川健行，深入 Hooker Valley 捕捉震撼冰雪構圖', wear:'防水防風外套＋保暖層＋登山鞋', weatherIco:'🌤️', spots:[
  S('Mt. Cook 冰川健行','activity','直升機引導冰河健行或塔斯曼冰河船體驗。降落冰河探索藍色冰洞。',{note:'極度依賴天候狀況。強烈建議報名早班場次。', fullDesc:'庫克山區最震撼的直升機引導冰河健行（Heli-Hike）或塔斯曼冰河船體驗。搭乘直升機飛越宏偉的冰川裂隙，降落在潔白無瑕的塔斯曼冰河上，在專業嚮導帶領下穿上冰爪，探索神秘的藍色冰洞與冰晶地貌。', img:'https://dynamic-media-cdn.tripadvisor.com/media/photo-o/0d/7b/10/6f/getlstd-property-photo.jpg?w=1200&h=-1&s=1'}), 
  S('Hooker Valley Track','activity','最著名景觀步道。依序跨越三座吊橋，終點冰河湖。',{tags:['必拍'],dur:'來回約3-4小時', note:'全長約10公里', fullDesc:'全紐西蘭最著名、被公認景觀價值最高的步道。步道全程修築平整，沿途會依序跨越三座壯觀的鋼索吊橋，橫跨湍急的胡克河，終點是胡克冰河湖。初春時節，湖面上常漂浮著從冰河斷裂崩塌的巨大藍色浮冰，景象如北極般震撼。', tip:'吊橋上風勢極強且容易搖晃。強烈建議早上 8 點前清晨出發，此時高山氣流最穩定、遊客稀少。', park:'步道起點位於 White Horse Hill 營地停車場，設有公廁與飲水機。', docMap:'https://www.doc.govt.nz/parks-and-recreation/places-to-go/canterbury/places/aoraki-mount-cook-national-park/tracks/hooker-valley-track/', img:'https://www.earthtrekkers.com/wp-content/uploads/2023/11/Hooker-Valley-Track-Trail-Guide.jpg.optimal.jpg'}), 
  S('Red Tarns Track','activity','從庫克山村陡升而上的健行步道，終點是能倒映庫克山的高山小湖泊。',{img:'https://trackslesstravelled.com/wp-content/uploads/2023/06/red-tarns-track-red-tarns-view-portrait.jpg', tags:['必拍'],dur:'約2小時(來回)', fullDesc:'從庫克山村公共涼亭出發，先跨過 Black Birch Stream 上的橋樑，接著便是連續陡上的階梯路段，爬升約300公尺。步道終點是被紅色水藻染色的高山小湖泊「紅色小湖」，天氣晴朗無風時能清楚倒映出庫克山與塞福頓山的壯麗山形，是欣賞日落的絕佳地點。'}), 
  ], 
  moreSpots: [
    S('Old Mountaineers Cafe','food','庫克山村內的老牌酒吧餐廳，主打漢堡披薩等家常菜，健行後補給的熱門選擇。',{img:'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRrQZoFEumaJYxDD93Ijut6idORe31z0Z5XMSnmUWLEPSrPK5huPVnZmTA&s=10', tags:['必吃'], hours:'10:00–19:00左右(依季節調整)', fullDesc:'位於庫克山村內、自2003年開業的老牌酒吧餐廳，牆上掛滿早期登山探險的歷史照片，氣氛輕鬆懷舊。菜單以漢堡、披薩、湯品等家常菜為主，份量實在，健行過後在戶外座位區配著庫克山景色用餐相當愜意，也可以只是點杯咖啡或啤酒稍作休息。'}), 
    S('Mt Cook Motels','hotel','連住第二晚。',{link:'https://www.hermitage.co.nz/stay/mt-cook-motels/', linkLabel:'查看房源官網', fullDesc:'連住第二晚。附近 Chamois Bar & Grill 供應酒吧簡餐，下午4點後營業，可作為晚餐備案。', img:'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d7/Lake_Pukaki_and_Mount_Cook.jpg/640px-Lake_Pukaki_and_Mount_Cook.jpg'})]},
{dayNum:'7', date:'9/19', weekday:'六', region:'跨域・遇藍影', enRegion:'Mt Cook → Oamaru', drive:'🚗 約 205 km / 2.5小時', gas:'⛽ Oamaru 市區 Z Energy 補滿', title:'辭別 Tasman Glacier，企鵝奇遇', dayDesc:'從冰川退回東海岸，走入 Oamaru 的歷史街區與可愛藍企鵝相遇', wear:'外套可隨氣溫調整，沿海歐瑪魯較溫和', weatherIco:'⛅', spots:[
  S('Tasman Glacier View','activity','短程健行景觀步道。觀景台可居高臨下俯瞰冰河末端。',{tags:['必拍'], dur:'約40–50分鐘', fullDesc:'位於庫克山另一側的短程健行景觀步道。需要攀爬一段由岩石鋪設的台階台地，攻頂後的觀景台可居高臨下俯瞰全紐西蘭最長的冰河——塔斯曼冰河末端巨大的灰色冰河湖。', docMap:'https://www.doc.govt.nz/parks-and-recreation/places-to-go/canterbury/places/aoraki-mount-cook-national-park/tracks/tasman-glacier-view/', img:'https://www.aa.co.nz/content/dam/nzaa/02-services/travel/editorial-locations/Canterbury/kuno-schweizer-3tVbuvA2emE-unsplash-1.jpg'}), 
  S('Tyne Street','attraction','歐瑪魯老城區核心。完整保存19世紀維多利亞式白色古典建築。',{tags:['必拍'], fullDesc:'歐瑪魯老城區的核心街道。這裡完整保存了 19 世紀末期因淘金熱與港口貿易而興建的維多利亞式白色奧瑪魯石（石灰岩）古典建築。如今進駐了許多復古二手書店、手工藝品店，充滿濃郁的英倫懷舊電影感。', img:'https://nikiinnewzealand.com/wp-content/uploads/2022/05/oamarusquare.jpg'}), 
  S('Blue Penguin Colony','attraction','野生藍企鵝觀賞區。傍晚時分，企鵝會成群結隊游回岸邊。',{tags:['必拍'], hours:'依日落變動', note:'觀賞席約 $45 NZD，全區嚴禁攝影', fullDesc:'歐瑪魯最具代表性的野生藍企鵝保育觀賞區。傍晚時分，這群身高僅約 30 公分的可愛企鵝會成群結隊從小夜海中游回岸邊。園區設有階梯式看台，並提供專業英文生態解說服務。', img:'https://www.urbanwildlifetrust.org/wp-content/uploads/2021/07/Oamaru0023.jpg'}), 
  ], 
  moreSpots: [
    S('Star and Garter','food','百年歷史復古餐酒館，主打紐西蘭頂級肋眼牛排與精釀啤酒。',{tags:['必吃'], hours:'11:30–21:00', fullDesc:'歐瑪魯百年歷史復古餐酒館，店內掛滿骨董裝飾，主打大份量紐西蘭頂級肋眼牛排與現調精釀啤酒。', img:'https://www.waitaki.govt.nz/files/assets/public/v/1/images/events/2023/soup-sipper/star-garter-sss-aug-23_8.jpg?w=1080', recDishes:'頂級肋眼牛排'}), 
    S('The Better Batter NZ','food','深受碼頭工人喜愛的炸魚薯條老店，外皮金黃酥脆。',{tags:['必吃'], hours:'12:00–19:30 (一休)', fullDesc:'深受在地碼頭工人喜愛的炸魚薯條老店，外皮金黃酥脆，魚肉鮮嫩多汁。', img:'https://dynamic-media-cdn.tripadvisor.com/media/photo-o/32/98/85/6e/caption.jpg?w=1100&h=1100&s=1', recDishes:'Blue Cod 炸魚'}), 
    S('Lune Lux','hotel','今晚住宿，歐瑪魯特色風格住宿。',{link:'https://www.booking.com/hotel/nz/lune-lux.html', linkLabel:'查看 Booking.com', fullDesc:'今晚住宿，歐瑪魯極具特色的風格住宿。', img:'https://upload.wikimedia.org/wikipedia/commons/thumb/9/91/Oamaru_Historic_Area.jpg/640px-Oamaru_Historic_Area.jpg'})]},
{dayNum:'8', date:'9/20', weekday:'日', region:'巡洋・逢生靈', enRegion:'Oamaru → Dunedin', drive:'🚗 約 115 km / 1.5小時', title:'探秘 Tunnel Beach，古典晨韻', dayDesc:'穿梭於農夫市集與海貌奇景之間，感受 Dunedin 的建築底蘊', wear:'防風外套，沿岸海風較大', weatherIco:'🌤️', spots:[
  S('Katiki Point Lighthouse','attraction','莫拉基半島南端燈塔。稀有黃眼企鵝與海獅棲息地。',{tags:['必拍'], hours:'07:30–17:30 (保護企鵝)', fullDesc:'位於莫拉基半島南端的高聳燈塔海岬。這裡是一處極其珍貴的野生動物保護區，是稀有的黃眼企鵝以及巨大的紐西蘭毛皮海獅的天然棲息地。', tip:'請嚴格與野生動物保持安全距離。', img:'https://dynamic-media-cdn.tripadvisor.com/media/photo-o/1b/02/fd/71/photo4jpg.jpg?w=1200&h=-1&s=1'}), 
  S('Huriawa Pa walk','activity','Karitane半島的毛利古堡遺址環形步道，沿途可見噴水洞與遼闊海岸線景觀。',{img:'https://dynamic-media-cdn.tripadvisor.com/media/photo-o/2d/2f/18/cb/caption.jpg?w=1200&h=1200&s=1', tags:['私房'],dur:'約45分鐘(環形)', fullDesc:'位於 Dunedin 北方 Karitane 半島上的歷史步道，環繞整個半島一圈，是18世紀毛利酋長 Te Wera 率族人抵禦長達半年圍城的古堡遺址（pā）。沿途設有解說牌介紹當地歷史，途經噴水洞（incoming tide 會從岩縫中噴出水柱），視野可遠眺南北兩側的海灣與峭壁景觀，全程約45分鐘，適合全家同行。'}), 
  S('Tunnel Beach','activity','海蝕地形奇景。步道沿懸崖下行，終點為神秘岩石隧道。',{tags:['必拍'],dur:'來回約1.5小時', fullDesc:'南島最為震撼的海蝕地形奇景之一。此步道沿著陡峭的金黃色砂岩懸崖一路下行，步道終點為一處手工鑿通的神秘岩石隧道，穿過隧道即可抵達隱密的分裂沙灘。', tip:'回程是一段連續且頗有坡度的陡峭上坡路。強烈建議查詢當日潮汐表，選擇退潮時段（Low Tide）前往，此時神祕沙灘才會完全暴露。', docMap:'https://www.doc.govt.nz/parks-and-recreation/places-to-go/otago/places/dunedin-area/tracks/tunnel-beach-track/', img:'https://cdn.sanity.io/images/n1o990un/production/d69da66f268d1a2c7c15c50075e73dc70c7e1c66-1200x900.jpg'}), 
  S('First Church of Otago','attraction','但尼丁最傑出的哥德復興式教堂。56公尺鏤空尖塔。',{tags:['必拍'], hours:'10:00–16:00', note:'免費參觀', fullDesc:'但尼丁最傑出的哥德復興式教堂地標。由名建築師設計，於 1873 年完工，其精雕細琢的白色奧瑪魯石材外牆與高達 56 公尺的優雅鏤空尖塔，直插雲霄。', img:'https://simonfieldhouse.com/wp-content/uploads/2013/04/First-Church-of-Otago-Dunedin-Simon-Fieldhouse-1.jpg'}), 
  ], 
  moreSpots: [
    S('Oamaru Farmers\' Market','shopping','歷史港區旁的在地農夫市集。',{tags:['必買'], hours:'週六 09:30–13:00', fullDesc:'每週六早上限定開放的在地農夫市集，聚集了奧塔哥地區的小農、起司工匠與手作職人。', img:'https://waitakinz.com/assets/Tourism-Operators/Oamaru-Farmers-Market/OFM-11__ScaleWidthWzkwMF0.jpg'}), 
    S('Rising Sun Dumplings','food','但尼丁市中心受歡迎的現代中式麵食館。主打手工現包煎餃。',{tags:['必吃'], hours:'11:30–21:00', fullDesc:'但尼丁市中心大受學生與當地年輕人歡迎的現代中式麵食館。主打手工現包、皮 Q 餡多汁的爆漿煎餃與酸辣麵。', img:'https://img.cdn4dd.com/cdn-cgi/image/fit=cover,width=600,height=400,format=auto,quality=80/https://doordash-static.s3.amazonaws.com/media/store/header/75a63dde-f625-4797-8a67-899f165b07fa.jpg', recDishes:'豬肉韭菜煎餃'}), 
    S('Bluestone On George','hotel','今晚住宿，位於但尼丁市中心，步行可達多數景點。',{link:'https://www.bluestonedunedin.co.nz/', linkLabel:'查看官網', fullDesc:'今晚住宿，位於但尼丁市中心喬治街附近，步行可達多數景點。', img:'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3c/Dunedin_George_Street.jpg/640px-Dunedin_George_Street.jpg'})]},
{dayNum:'9', date:'9/21', weekday:'一', region:'逐風・半島行', enRegion:'Otago Peninsula', drive:'🚗 半島來回約 60 km / 1.5小時', gas:'⛽ Dunedin Pak\'nSave 採買加滿', title:'Otago Peninsula 生態，與信天翁共舞', dayDesc:'乘船出海追尋生態奇蹟，在 Sandfly Bay 記錄生命躍動', wear:'防風防水外套，半島風大且天候多變', weatherIco:'⛅', spots:[
  S('Monarch Wildlife Cruises','activity','頂級海洋生態遊船。近距離仰望翼展3公尺的皇家信天翁翱翔。',{tags:['必拍'], hours:'依預約班次', note:'依行程約 $60-$120 NZD', fullDesc:'全紐西蘭最頂級的海洋生態遊船體驗之一。從小港口出發，航行至奧塔哥半島陡峭岬角海域。在船上可以近距離仰望這群翼展超過 3 公尺的皇家信天翁在狂風中翱翔的英姿。', img:'https://www.nztravelorganiser.com/wp-content/uploads/2019/09/dunedin-activities.jpg'}), 
  S('Sandfly Bay','activity','隱密野性海灘。需徒步穿越陡峭沙丘，經常有海獅在沙灘睡覺。',{tags:['必拍'],dur:'來回約1.5小時', fullDesc:'隱密且充滿野性美的僻靜海灘。要抵達海岸，必須先徒步穿越一段巨大且陡峭的白色沙丘地形。這裡因經常有巨大的紐西蘭海獅在沙灘上睡覺、社交而聞名。', tip:'法規嚴格規定必須與海獅保持至少 20 公尺安全距離。', docMap:'https://www.doc.govt.nz/parks-and-recreation/places-to-go/otago/places/dunedin-area/tracks/sandfly-bay-track/', img:'https://dunedinattractions.nz/images/sandfly-bay/hero.jpg'}), 
  S('Sir Leonard Wright Lookout','attraction','John Wilson Ocean Drive盡頭的觀景台，可遠眺南Dunedin海岸線與太平洋。',{img:'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTxK2_YhkD5YNG36EVIgia3G5nxvG0mO881SIdlbuwHWxrTbZITZ7u5nLrU&s=10', tags:['私房'], fullDesc:'位於 John Wilson Ocean Drive 盡頭、Lawyers Head 高處的觀景台，緊鄰高爾夫球場。可俯瞰 St Clair、St Kilda 等南 Dunedin 海灘與連綿沙丘，太平洋海浪拍打岩岸的畫面十分壯闊，也是熱門的日出日落景點。注意：John Wilson Drive 平日僅於11:00–15:00開放車輛通行，其餘時段須步行或騎車前往。'}), 
  S('North Dunedin','attraction','奧塔哥大學所在的學生城區，以藍石建築校園與波希米亞氛圍聞名。',{img:'https://a0.muscache.com/im/pictures/INTERNAL/INTERNAL-Dunedin/original/52c60f65-7a51-45d4-9c7b-e2ef6b7e3464.jpeg', dur:'約1小時(散步)', fullDesc:'紐西蘭最古老的奧塔哥大學（University of Otago）所在的城區，距市中心 Octagon 約步行20分鐘。校園核心區以藍石（bluestone）打造的古典建築群最為知名，洋溢濃厚的學生城與波希米亞氣息，鄰近植物園與奧塔哥博物館，適合悠閒漫步感受 Dunedin 蘇格蘭風情與年輕活力交織的一面。'}), 
  ], 
  moreSpots: [
    S('Beam Me Up Bagels','food','但尼丁極具名氣的手工紐約式貝果專賣店。',{tags:['必吃'], hours:'08:00–14:30', fullDesc:'但尼丁極具名氣的手工紐約式貝果專賣店。主打每天清晨新鮮現燙現烤、口感紮實有嚼勁的貝果。', img:'https://asset.turboweb.co.nz/152/cache/file/b2ghq7ar6rlw1uxeovgz/1a6a5458b8c71af765cc20c7e24ad633/IMG_8079.jpeg', recDishes:'鮭魚乳酪貝果'}), 
    S('Plato','food','殿堂級海鮮餐廳，菜單依當日現撈漁獲彈性調整。',{tags:['必吃'], hours:'18:00起 (一休)', note:'強烈建議提前預訂', fullDesc:'但尼丁首屈一指的殿堂級海鮮餐廳，坐落於海港碼頭旁的一棟復古建築內。菜單依當日漁船捕撈的現撈漁獲彈性調整。', img:'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRgVI9iwdwtgfC9idPmlBr8Piem59_Bb8Px4vjx8YMFicM2l5nyM3BPCnib&s=10', recDishes:'每日現撈漁獲 (Catch of the day)'}), 
    S('Pak\'nSave Dunedin','shopping','於此進行大補給，並領取加油折價券。',{tags:['必買'], hours:'07:00–22:00', fullDesc:'紐西蘭公認物價最便宜的黃色連鎖巨型倉儲式超市。由於接下來將深入峽灣等偏遠地區，建議在但尼丁進行最大規模的食材大補給。', img:'https://upload.wikimedia.org/wikipedia/commons/a/a5/Pak%27n_Save_Wanganui.JPG'}), 
    S('Bluestone On George','hotel','連住第二晚。',{link:'https://www.bluestonedunedin.co.nz/', linkLabel:'查看官網', fullDesc:'連住第二晚。', img:'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3c/Dunedin_George_Street.jpg/640px-Dunedin_George_Street.jpg'})]},
{dayNum:'10', date:'9/22', weekday:'二', region:'尋味・向水岸', enRegion:'Dunedin → Te Anau', drive:'🚗 約 290 km / 3.5小時', title:'品味南島晨韻，啟程 Te Anau 靜謐時光', dayDesc:'用 Dunedin 人氣早午餐喚醒味蕾，驅車前往峽灣門戶', wear:'保暖外套，湖區日夜溫差明顯', weatherIco:'🌥️', spots:[
  S('Lake Te Anau','attraction','南島第一大湖，前往米佛峽灣的門戶。西側對岸是原始溫帶雨林。',{tags:['必拍'], fullDesc:'紐西蘭第二大湖、南島第一大湖。蒂阿瑙湖是通往宏偉的米佛峽灣與峽灣國家公園的咽喉門戶。相較於觀光氣息濃厚的瓦卡蒂普湖，這裡多了一份與世隔絕的莊嚴與靜謐。', img:'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6b/Lake_Te_Anau_New_Zealand.jpg/640px-Lake_Te_Anau_New_Zealand.jpg'}), 
  S('Marakura Wharf','attraction','蒂阿瑙小鎮湖畔木製老碼頭。捕捉湖景最經典的攝影取景點。',{tags:['必拍'], fullDesc:'位於蒂阿瑙小鎮湖畔步行道旁的一座古樸木製老碼頭。這裡木棧道朝湖心延伸，是捕捉蒂阿瑙湖景最經典的攝影取景點。', img:'https://cdn.prod.rexby.com/image/b16fbf9e5f954b428213c515635ba3bf?format=webp&width=1080&height=1350&quality=80'}), 
  ], 
  moreSpots: [
    S('Patti\'s & Cream Diner','food','殿堂級早午餐，以極致邪惡的手工漢堡與美式冰淇淋聞名。',{tags:['必吃'], hours:'08:00–15:00', fullDesc:'但尼丁殿堂級早午餐推薦，以極致邪惡的手工漢堡與自家製美式冰淇淋聞名。', img:'https://images.squarespace-cdn.com/content/v1/637433a81477ab05e9343293/393fbcc0-5984-4baf-b815-f5c06f722cb0/patti%27s+%26+cream+february+2023-31.JPG', recDishes:'手打美式漢堡、手工冰淇淋'}), 
    S('Black\'s Hut','hotel','今晚住宿。湖濱小屋，就在蒂阿瑙湖畔，附熱水浴缸。5.0分評等。',{link:'https://www.airbnb.com/rooms/52614454', linkLabel:'查看 Airbnb 房源', fullDesc:'今晚住宿。2022年新建的湖濱小屋，就在蒂阿瑙湖畔，兩間各自獨立的臥室與衛浴、附熱水浴缸（冷涼季節升溫較慢，建議提早入住讓水溫達標）。5.0分評等。', img:'https://a0.muscache.com/im/pictures/miso/Hosting-52614454/original/18a29ea2-3bf9-4b93-9cdc-e44fcdd7405b.jpeg?im_w=720'})]},
{dayNum:'11', date:'9/23', weekday:'三', region:'入林・探祕境', enRegion:'Te Anau', drive:'🚗 單趟約 10 km / 15分', gas:'⛽ 出發峽灣或長途前於 NPD 加滿', title:'深入 Kepler Track，傾聽森林微語', dayDesc:'踏上紐西蘭頂級步道，在繁茂雨林與湖光山色中深度森呼吸', wear:'全套防水裝備＋保暖衣物，山區多變', weatherIco:'🌦️', spots:[
  S('Kepler Track Trail','activity','九大偉大健行步道。穿過原生山毛櫸森林，抵達 Brod Bay 折返。',{tags:['必拍'],dur:'約4–6小時', fullDesc:'紐西蘭官方指定的「九大偉大健行步道」之一。從小鎮控制閘門出發，沿著蔚藍的蒂阿瑙湖畔穿過長滿青苔、宛如阿凡達魔幻世界的高聳原生山毛櫸原始森林，抵達 Brod Bay 沙灘折返。', tip:'出發前必須至小鎮 DOC 旅客中心確認當日高山天氣與雪線警示。防風防水外殼、防滑登山鞋為絕對必備。', park:'步道起點 Kepler Track Car Park 設有大型免費停車場。', docMap:'https://www.doc.govt.nz/parks-and-recreation/places-to-go/fiordland/places/fiordland-national-park/tracks/kepler-track/', img:'https://tourexotico.com/wp-content/uploads/2022/11/kepler11.jpg'}), 
  S('Te Anau Bird Sanctuary','attraction','蒂阿瑙湖畔的免費賞鳥保護區，可近距離觀察紐西蘭珍稀的無翼秧雞(Takahē)。',{img:'https://www.sit.ac.nz/Portals/0/EasyDNNnews/1897/TAKAHE-at-Te-Anau-Bird-Sanctuary.JPG', dur:'約40分鐘', fullDesc:'位於蒂阿瑙湖畔的 Punanga Manu o Te Anau 賞鳥保護區，從 Fiordland 國家公園遊客中心步行約15-20分鐘可達。免費入園（歡迎樂捐），是近距離觀賞紐西蘭珍稀鳥類的絕佳地點，明星動物是曾一度被認為已滅絕、後來奇蹟重現的無翼秧雞（Takahē），此外還能看到卡卡鸚鵡、林鴿與圖伊鳥等原生鳥種，園內設有休憩桌椅與洗手間，適合安排在森林健行前後順遊。'}), 
  ], 
  moreSpots: [S('Black\'s Hut','hotel','連住第二晚，回到湖畔小屋泡熱水浴缸放鬆。',{link:'https://www.airbnb.com/rooms/52614454', linkLabel:'查看 Airbnb 房源', fullDesc:'連住第二晚，凱普勒步道健行後回到湖畔小屋泡熱水浴缸放鬆。入住透過智慧門鎖自助辦理。', img:'https://a0.muscache.com/im/pictures/miso/Hosting-52614454/original/18a29ea2-3bf9-4b93-9cdc-e44fcdd7405b.jpeg?im_w=720'})]},
{dayNum:'12', date:'9/24', weekday:'四', region:'御風・俯瞰城', enRegion:'Te Anau → Queenstown', drive:'🚗 約 170 km / 2小時', title:'登頂 Queenstown 天際線與光影', dayDesc:'由 Deer Park Heights 絕美視角，搭配義式冰淇淋，收攬百萬美景', wear:'輕便外套即可，皇后鎮市區較和緩', weatherIco:'☀️', spots:[
  S('Lake Wakatipu Viewpoint','attraction','卓越山脈的鋸齒狀山脊線與寶藍色湖水形成極具張力的對比。',{tags:['必拍'], fullDesc:'位於通往格蘭諾奇公路起點不遠處的路邊高處觀景點。從這個觀景點看過去，卓越山脈的鋸齒狀山脊線與寶藍色湖水形成極具戲劇張力的對比。', img:'https://www.campervannewzealand.co.nz/assets/img/blog/564/shutterstock_789431650-compressed.jpg'}), 
  S('Deer Park Heights','attraction','私人牧場觀景區，可近距離接觸鹿群，俯瞰皇后鎮全景。',{tags:['必拍'], hours:'日間開放', note:'每車約 $55 NZD，需線上預約', fullDesc:'私人牧場觀景區，可近距離接觸鹿群，並俯瞰瓦卡蒂普湖與皇后鎮全景，也是多部電影取景地。', img:'https://scontent-xxc1-1.xx.fbcdn.net/v/t39.30808-6/498271435_3838751466454752_5305341638292454672_n.jpg?stp=dst-jpg_tt6&cstp=mx2048x1536&ctp=s2048x1536&_nc_cat=101&ccb=1-7&_nc_sid=aa7b47&_nc_ohc=eXYXDvafWzYQ7kNvwEzRwO-&_nc_oc=AdpnuVlkHgbBYgtfbm_COr-ueg_G7f_2qxQh9wGs4oLzE33zxqKBhkN4Z1yxLZxM4zYlNiE6rc_OtaCTrTd2EFsp&_nc_zt=23&_nc_ht=scontent-xxc1-1.xx&_nc_gid=7VvAF3uo5gYs9J44jng6kQ&_nc_ss=7b2a8&oh=00_AQB9eoDtE9CRNn5Sxk0GS2D_DnuRBVx8TjyKj1dsHj8T6Q&oe=6A592036'}), 
  S('Queenstown Skyline','attraction','搭乘空中纜車直達鮑勃峰山頂。鳥瞰皇后鎮經典殿堂級視角。',{tags:['必拍'], hours:'09:30–20:00', note:'成人纜車約 $53 NZD', fullDesc:'搭乘南半球最陡峭的空中纜車直達鮑勃峰山頂。山頂觀景台是鳥瞰皇后鎮最經典的殿堂級視角：整片呈 Z 字型的瓦卡蒂普湖、卓越山脈一覽無遺。', img:'https://queenstown.skyline.co.nz/cdn-cgi/image/quality=75,width=1920,height=1080,f=auto,fit=cover/https://media.skyline.co.nz/queenstown/media/uploads/2023/11/12135919/Skyline-Queenstown_Gondola_Remarkables_M.png'}), 
  ], 
  moreSpots: [
    S('Anita Gelato','food','來自國際名店，主打極致濃郁的手工義式冰淇淋。',{tags:['必吃'], hours:'09:00–22:30', fullDesc:'來自國際名店，主打極致濃郁的手工義式冰淇淋與豐富淋醬。', img:'https://media.timeout.com/images/105899787/image.jpg', recDishes:'帕芙洛娃雪酪'}), 
    S('Patagonia Chocolate','food','南島巧克力霸主，酸甜水果雪酪搭配無敵湖景是一絕。',{tags:['必吃'], hours:'09:00–21:00', fullDesc:'南島巧克力霸主，其榛果巧克力與酸甜水果雪酪搭配無敵湖景是一絕。', img:'https://ak-d.tripcdn.com/images/1mi2z224x99lpaw60F649.jpg?proc=source/trip', recDishes:'榛果巧克力冰淇淋'}), 
    S('Mrs Ferg Gelateria','food','Fergburger 帝國旗下冰淇淋店，份量驚人。',{tags:['必吃'], hours:'08:00–23:00', fullDesc:'Fergburger 帝國旗下的冰淇淋店，份量驚人。', img:'https://images.happycow.net/venues/1024/10/64/hcmp106464_635138.jpeg', recDishes:'手工冰淇淋'}), 
    S('Duck Island Ice Cream','food','以各種瘋狂且極具創意的奇特口味聞名。',{tags:['必吃'], hours:'10:00–22:00', fullDesc:'以各種瘋狂且極具創意的奇特口味聞名的超人氣冰淇淋店。', img:'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQQ_C-oynyYX2_gFjF30i_yMlIUXQHBJhgnwB1amIG9lOFIS8jiqQLWvy8M&s=10', recDishes:'烤棉花糖冰淇淋'}), 
    S('Goldrush Escape','hotel','今晚住宿。Goldfield Heights 現代2房公寓，主臥眺望瓦卡蒂普湖。',{link:'https://www.airbnb.com.tw/rooms/16826185', linkLabel:'查看 Airbnb 房源', fullDesc:'今晚住宿。位於 Goldfield Heights 的現代2房公寓，客廳與主臥皆可眺望瓦卡蒂普湖與 The Remarkables 山景，距機場、超市與市區車程約10分鐘。', img:'https://a0.muscache.com/im/pictures/bc4e16f4-6a65-4f6e-8576-bd063d744ec1.jpg?im_w=720'})]},
{dayNum:'13', date:'9/25', weekday:'五', region:'淘金・尋古光', enRegion:'Arrowtown', drive:'🚗 單趟約 20 km / 20分', title:'Arrowtown 的時光倒流，舌尖上的狂歡', dayDesc:'漫步秋意漸濃的淘金小鎮，用極致罪惡的經典漢堡與烘焙犒賞自己', wear:'輕便保暖外套，市區逛街為主', weatherIco:'🌤️', spots:[
  S('Arrow Town','attraction','保存極為完好、充滿傳奇的 19 世紀歷史淘金小鎮。',{tags:['必拍'], fullDesc:'保存得極為完好、充滿傳奇色彩的 19 世紀歷史淘金小鎮。走在落葉繽紛的白金漢街上，兩旁盡是古老精緻的木造與石造老房子。', img:'https://dynamic-media-cdn.tripadvisor.com/media/photo-o/04/6d/ef/72/arrowtown-s-historic.jpg?w=600&h=400&s=1'}), 
  S('Moke lake walk','activity','距皇后鎮車程約15-20分鐘的環湖步道，湖光山色寧靜脫俗，是在地人私藏的秘境。',{img:'https://hikingscenery.com/wp-content/uploads/2021/06/1110288-1200x800.jpg', tags:['私房'],dur:'約2小時(環形)', fullDesc:'距皇后鎮車程約15-20分鐘（最後一段為碎石路）的環湖步道，全程約6公里、需2小時左右，沿著草原與濕地平緩起伏繞行 Moke Lake 一圈，四周被群山環抱，遊客明顯較少，是在地人私藏的世外桃源。無風時湖面如鏡倒映山影，也可延伸健行至觀景高點俯瞰全湖，湖區禁止攜帶寵物同行。'}), 
  S('Queenstown downtown','attraction','皇后鎮市中心湖濱區，沿岸串連 Queenstown Gardens、Steamer Wharf 與歷史碼頭。',{tags:['必拍'], fullDesc:'皇后鎮最熱鬧的市中心湖濱區，沿著瓦卡蒂普湖岸邊散步即可串起多個知名地標：復古蒸汽船 TSS Earnslaw 停靠的老碼頭、聚集餐廳與精品店的 Steamer Wharf 娛樂碼頭區，以及沿湖岸延伸的 Queenstown Gardens 湖畔花園，園內有玫瑰園、圓盤高爾夫與林蔭步道。傍晚時分沿湖漫步、找間酒吧坐下欣賞湖景與山色，是體驗皇后鎮悠閒氛圍最道地的方式。'}), 
  ], 
  moreSpots: [
    S('Remarkable Sweet Shop','shopping','指標性復古糖果專賣店。傳統手工軟糖是最受歡迎的伴手禮。',{tags:['必買','必拍'], hours:'09:30–17:30', fullDesc:'位於箭鎮與皇后鎮鬧區的指標性復古糖果專賣店。店內裝潢高聳，整面牆擺滿了來自世界各地的色彩繽紛糖果。傳統手工軟糖是最受歡迎的精緻伴手禮。', img:'https://dynamic-media-cdn.tripadvisor.com/media/photo-o/1c/dd/7c/04/our-lovely-new-arrowtown.jpg?w=1200&h=-1&s=1'}), 
    S('Fergburger','food','國際地標級名店，漢堡體積巨大、麵包現烤，肉厚實多汁。',{tags:['必吃'], hours:'08:00–04:30', note:'建議提前電話預訂以免久候', fullDesc:'享譽全球的國際地標級名店，排隊人潮幾乎不分晝夜，其漢堡體積巨大、麵包每日現烤、牛肉漢堡肉厚實多汁。', img:'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTCd8zkTmF2wTAhyb7xVMhZnrEcr6uQPsd64ctLJHUPDfY086EvVxr9xFU7&s=10', recDishes:'The Fergburger'}), 
    S('Fergbaker','food','緊鄰 Fergburger 隔壁的同集團頂級歐式烘焙坊。傳統肉派評價極高。',{tags:['必吃'], hours:'06:00–02:00', fullDesc:'緊鄰 Fergburger 隔壁的同集團頂級歐式烘焙坊。店內空氣中瀰漫著濃郁的奶油與烘焙香氣，售賣的紐西蘭傳統鹿肉派、奶油雞肉派評價極高。', img:'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ-hQ9PnBYlaEFh7mXVvpIykQtvG9InJQpVuzMJ82RCV37u-8zvtGHRyBY&s=10', recDishes:'鹿肉派 (Venison Pie)'}), 
    S('Queenstown Mall','shopping','皇后鎮市中心的徒步商店街，聚集精品、紀念品店與各國美食小吃。',{img:'https://res.cloudinary.com/simpleview/image/upload/v1709004257/clients/queenstownnz/Remarkables_shops_41c7cef1-761b-4bb4-97bb-c22fd91e24fb.jpg', fullDesc:'位於皇后鎮市中心的徒步購物街區，緊鄰湖濱與碼頭，短短幾條街聚集了戶外服飾品牌、羊毛製品、紀念品店與珠寶店，晚上也有不少酒吧與各國料理餐廳，是晚餐後散步、採買紀念品或找地方喝一杯的方便去處。'}), 
    S('Erik\'s Fish and Chips','food','皇后鎮人氣魚薯條專賣店，主打在地直送鮮魚，還有招牌炸奇異果甜點。',{img:'https://assets.simpleviewinc.com/simpleview/image/upload/c_limit,h_1200,q_75,w_1200/v1/crm/queenstownnz/1C039810-3672-48A0-AA02-D4723ECC6557_15C8748E-1517-4F87-8163E1D773130876_9fbc6e71-cc38-4724-b899328424ffb364.jpg', tags:['必吃'], fullDesc:'位於皇后鎮市區的人氣魚薯條專賣店，魚貨每日自 Dunedin 直送，馬鈴薯則來自 Canterbury，可選擇 Hoki、Dory 或藍鱈等魚種，另有炸魷魚、青口、Bluff生蠔等海鮮選項，全品項皆可做成無麩質，也有清真認證。招牌甜點「炸奇異果」是必嚐的特色小吃，買了外帶走到附近湖濱邊吃邊賞景是在地人的經典吃法。', recDishes:'招牌炸奇異果、Hoki魚排'}), 
    S('Goldrush Escape','hotel','連住第二晚。',{link:'https://www.airbnb.com.tw/rooms/16826185', linkLabel:'查看 Airbnb 房源', fullDesc:'連住第二晚。公寓不含早餐，需自行採買，附平面電視／Netflix，戶外露台適合晴天小酌看山景。', img:'https://a0.muscache.com/im/pictures/bc4e16f4-6a65-4f6e-8576-bd063d744ec1.jpg?im_w=720'})]},
{dayNum:'14', date:'9/26', weekday:'六', region:'魔戒・極致味', enRegion:'Glenorchy', drive:'🚗 單趟約 45 km / 45分', title:'Glenorchy 的純粹荒野，頂級饗宴', dayDesc:'深入世界盡頭的電影級大景，於 Queenstown 以頂級饗宴為旅程完美作結', wear:'輕便外套＋防風層，湖畔風較大', weatherIco:'⛅', spots:[
  S('Wilson Bay','attraction','皇后鎮往格倫諾基公路旁的湖灣景點，是沿途熱門的停車拍照與野餐地點。',{img:'https://dynamic-media-cdn.tripadvisor.com/media/photo-o/23/6a/e1/4a/caption.jpg?w=1200&h=1200&s=1', fullDesc:'位於皇后鎮往格倫諾基（Glenorchy-Queenstown Road）沿線的湖灣，鄰近 Twelve Mile Delta，是這段風光明媚公路上熱門的中途停靠點。湖灣視野開闊，可眺望瓦卡蒂普湖與周圍山巒，適合下車拍照休息，也是電影《魔戒》的取景地之一。'}), 
  S('Bob\'s Cove Track & Nature Walk','activity','格倫諾基公路旁隱密的森林步道，穿越林間抵達私密秘境般的湖灣。',{img:'https://myqueenstowndiary.com/wp-content/uploads/2020/11/Bobs-Cove-Beach-near-Queenstown-New-Zealand.jpg', tags:['私房'],dur:'約30分鐘(來回)', fullDesc:'步道入口位於距皇后鎮約14公里的格倫諾基公路旁停車場，沿途穿越蒼翠茂密的森林緩緩下坡至湖畔，來回約半小時。步道盡頭的 Bob\'s Cove 湖灣清澈見底，宛如熱帶海灘般的翡翠色湖水令人驚艷，是夏季戲水與野餐的私房去處，也曾是採石場遺址，沿途設有解說牌介紹歷史。夏季路旁停車位有限，建議避開尖峰時段前往。'}), 
  S('Bennetts Bluff Viewpoint Walking Track','activity','格倫諾基公路上視野最遼闊的觀景步道，能將瓦卡蒂普湖與皇后鎮群峰盡收眼底。',{img:'https://seethesouthisland.com/wp-content/uploads/2021/04/viewpoint-queenstown-drive-glenorchy-nz.jpg', tags:['必拍'],dur:'約15分鐘(來回)', fullDesc:'位於格倫諾基公路沿線、2021年新啟用的觀景步道，設有寬敞的專屬停車場，僅需步行約5分鐘即可登上觀景台。這裡是整條公路視野最遼闊的地點之一，能將瓦卡蒂普湖蜿蜒的湖岸線與皇后鎮周邊群峰盡收眼底，同時也設有野餐區，適合稍作停留欣賞風景。'}), 
  S('Glenorchy Wharf','attraction','開往格蘭諾奇，終點紅瓦小木屋是《魔戒》中艾辛格的取景大本營。',{tags:['必拍'], fullDesc:'從皇后鎮開往格蘭諾奇，終點的格蘭諾奇老碼頭矗立著一座標誌性的紅瓦小木屋，背後是氣勢磅礡的達特河谷雪山，是《魔戒》中「艾辛格」的取景大本營。', img:'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTDWp7j-wLjtRFcHson-Oqcii7ctv4m7m6eZk-YsK5ThvJznkKDqLsglnY&s=10'}), 
  S('glenorchy walkway','activity','格倫諾基碼頭出發的濕地木棧道環線，可欣賞恩斯洛山倒映在湖沼中的絕景。',{img:'https://www.doc.govt.nz/thumbs/hero/contentassets/2a8e2def465d474d9b996598bac87702/glenorchy-lagoon-1920.jpg', tags:['必拍'],dur:'約1-1.5小時(環形)', fullDesc:'從格倫諾基碼頭出發的濕地環形步道，全長約3.2至5公里（依走大圈或小圈而定），路徑平緩好走，途中會穿越一段架高木棧道，深入格倫諾基潟湖濕地。天氣平靜時，恩斯洛山（Mount Earnslaw）與周圍群山會完美倒映在水面上，如明鏡一般，沿途也是賞鳥的好地點，能看到多種原生水鳥。'}), 
  S('Glenorchy Animal Experience','activity','格倫諾基近郊的真實農場體驗，可近距離餵食羊駝、迷你馬、小豬等多種動物。',{img:'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQm7ahK_LdJocOCJ59L8pQwLeeRtuqzgUAJJPcgdkAWGWzmnbM4hItbiHjU&s=10', fullDesc:'位於格倫諾基近郊、通往 Paradise 途中的真實運作農場，同時也是開放參觀的迷你動物園。可以近距離餵食與互動的動物包括紐西蘭羊群與小羊、迷你馬與克萊茲代爾馬、羊駝、山羊、豬、驢子及兔子等，是全家大小都能樂在其中的體驗行程，也是支持在地小型農場經營的好方式。'}), 
  ], 
  moreSpots: [
    S('Remarkable Market','shopping','皇后鎮近郊在地假日市集。',{tags:['必買'], hours:'每週六 09:00–14:00', fullDesc:'逢週六在皇后鎮近郊 Frankton 開放的在地假日市集。匯集了手作藝術家、古董商與在地小農。', img:'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTN8mRbvFTeIbdAswlmSAPu1v-C308EVliTejdDbqEKh-0X5Gp0XqNzd7ut&s=10'}), 
    S('Jervois Steak House','food','最高檔頂級美式牛排館，嚴選 Wakanui 牛肉。',{tags:['必吃'], hours:'17:00–22:00', note:'強烈建議提前線上訂位', fullDesc:'皇后鎮最高檔的頂級美式高級牛排館，嚴選紐西蘭頂級熟成 Wakanui 牛肉。', img:'https://www.jervoissteakhouse.co.nz/media/pages/story/c05b98f51d-1764014775/jsh-qt-board.jpg', recDishes:'Wakanui 熟成肋眼牛排'}), 
    S('Flame Bar & Grill','food','超大份量、高 CP 值的窯烤秘製豬肋排。',{tags:['必吃'], hours:'12:00–22:30', fullDesc:'以超大份量、高 CP 值的窯烤秘製豬肋排與海陸雙拼餐酒館著稱。', img:'https://images.myguide-cdn.com/md/queenstown/companies/flame-bar-and-grill/large/flame-bar-and-grill-703896.jpg', recDishes:'秘製窯烤豬肋排'}), 
    S('Mrs Woolly\'s General Store','shopping','格倫諾基小鎮上的可愛雜貨店，兼營咖啡與伴手禮，緊鄰唯一的露營地。',{img:'https://mrswoollysgeneralstore.nz/cdn/shop/files/about_section_2_img_1_x2_1413b23d-5dd0-468c-a676-a0c5133facec.jpg?v=1686144241&width=812', fullDesc:'位於格倫諾基入口處、緊鄰 Mrs Woolly\'s Campground（鎮上唯一的露營地）的雜貨小店。除了販售日常雜貨與紀念品外，也提供咖啡與輕食，是進入格倫諾基前後稍作休息、採買伴手禮的可愛據點。'}), 
    S('Goldrush Escape','hotel','連住第三晚，退房前整理行李。',{link:'https://www.airbnb.com.tw/rooms/16826185', linkLabel:'查看 Airbnb 房源', fullDesc:'連住第三晚，也是本次旅程最後一晚住宿。退房時間為上午10點前，隔天前往機場僅約10分鐘車程。', img:'https://a0.muscache.com/im/pictures/bc4e16f4-6a65-4f6e-8576-bd063d744ec1.jpg?im_w=720'})]},
{dayNum:'15', date:'9/27', weekday:'日', region:'賦歸・長白雲', enRegion:'Queenstown Departure', drive:'🚗 約 10 km / 15分', title:'告別南十字星，將壯闊山河銘記於心', dayDesc:'帶著滿載視覺與味覺的史詩記憶，從 Queenstown 起飛圓滿南島紀元', wear:'機艙內較涼建議薄長袖', weatherIco:'☀️', spots:[
  S('NZ630 ZQN→AKL','transport','14:15 皇后鎮起飛，16:05 抵達奧克蘭。請提前 2 小時還車與登機。',{dur:'約1.5小時', fullDesc:'14:15 由皇后鎮機場起飛，16:05 抵達奧克蘭國際機場。請提前至少 2 小時辦理國內線登機與自駕車還車手續，結束這段完美的南島自駕旅程。', img:'https://www.airport-technology.com/wp-content/uploads/sites/14/2023/08/AIR-NZ.jpg'}), 
  S('CI54 AKL→BNE→TPE','transport','20:35 奧克蘭起飛，經布里斯本轉機，隔日(9/28)約 05:25 抵達桃園。',{dur:'約14小時', fullDesc:'20:35 奧克蘭起飛，經布里斯本轉機，隔日(9/28)約 05:25 抵達桃園。', img:'https://media.licdn.com/dms/image/v2/D5612AQH-SSeXExLoXA/article-cover_image-shrink_720_1280/B56ZfnfXcTHQAI-/0/1751935454439?e=2147483647&v=beta&t=HxF4MjarYVc6oIJqlUb02ok4B5AOzMtPTqRi3_pYCMg'})], 
  moreSpots: [
    S('市區／機場周邊','shopping','搭機前最後衝刺血拼時間。',{tags:['必買'], fullDesc:'搭機離開南島前的最後衝刺血拼時間。可以利用上午在市區或機場旁的連鎖大賣場，補齊尚未購足的麥蘆卡蜂蜜或巧克力。', img:'https://upload.wikimedia.org/wikipedia/commons/a/a5/Pak%27n_Save_Wanganui.JPG'})]}
];

/* ============ 筆記/照片/自訂景點系統 (LocalStorage 永久保存) ============ */

/* 共用安全寫入函式：localStorage 容量有限（通常僅 5-10MB／裝置），
   照片存多了可能會寫入失敗。統一在這裡攔截錯誤並提示使用者，
   而不是讓資料默默遺失、卻讓使用者誤以為「上傳照片沒反應」。 */
function safeSetItem(key, valueObj){
  let localOk = true;
  try {
    localStorage.setItem(key, JSON.stringify(valueObj));
  } catch(e) {
    localOk = false;
    console.error('localStorage 寫入失敗：', key, e);
  }
  // 若已啟用家人共享同步，改把資料推上雲端；雲端會自動用它自己的（容量大很多的）
  // 離線快取保存，所以就算這台裝置的 localStorage 滿了也不代表資料真的保不住。
  if (!cloudSync.applyingRemote) scheduleCloudPush(key, valueObj);
  if (!localOk && !cloudSync.enabled) {
    alert('⚠️ 這台裝置瀏覽器的儲存空間已滿，剛才的變更這次可能無法保存下來。\n\n建議：\n1. 到「指南」頁使用「📤 匯出備份」把目前資料存成檔案\n2. 刪除幾張較舊或較大的照片後再試一次\n3. 之後可用「📥 匯入備份」把資料復原');
    return false;
  }
  return true;
}

let notesStore = JSON.parse(localStorage.getItem('nz_notes')) || {};
/* 相容舊版資料：以前每個景點只能存一則筆記（字串），現在改成可以新增多筆 */
Object.keys(notesStore).forEach(k=>{
  if (typeof notesStore[k] === 'string') {
    notesStore[k] = notesStore[k].trim() ? [notesStore[k].trim()] : [];
  }
});
function persistNotes(){ safeSetItem('nz_notes', notesStore); }
function addNote(key) {
  const input = document.getElementById('note-input-'+key);
  if(!input) return;
  const text = input.value.trim();
  if(!text) return;
  if(!notesStore[key]) notesStore[key] = [];
  notesStore[key].push(text);
  persistNotes();
  renderDayContent();
  setTimeout(()=>{
    const card = document.getElementById('spot-card-'+key); if(card) card.classList.add('open');
    const editArea = document.getElementById('edit-note-'+key); if(editArea) editArea.style.display = 'block';
    const toggleBtn = document.getElementById('btn-note-'+key); if(toggleBtn) toggleBtn.style.display = 'none';
  }, 50);
}
function deleteNote(key, noteIdx) {
  if(!notesStore[key]) return;
  notesStore[key].splice(noteIdx, 1);
  persistNotes();
  renderDayContent();
  setTimeout(()=>{
    const card = document.getElementById('spot-card-'+key); if(card) card.classList.add('open');
  }, 50);
}
function toggleEditNote(event, key) {
  event.stopPropagation();
  const editArea = document.getElementById('edit-note-'+key);
  const toggleBtn = document.getElementById('btn-note-'+key);
  if (editArea.style.display === 'none') {
    editArea.style.display = 'block';
    if(toggleBtn) toggleBtn.style.display = 'none';
  } else {
    editArea.style.display = 'none';
    if(toggleBtn) toggleBtn.style.display = 'inline-block';
  }
}

/* 景點照片：改用 base64 存進 LocalStorage，重新整理／關閉頁面後仍會保留。
   上傳時會先自動壓縮（最長邊 1600px、JPEG 品質 0.82），
   避免手機原圖動輒 3-8MB，很快就把裝置的 localStorage 容量塞滿導致上傳失敗。 */
let photoStore = JSON.parse(localStorage.getItem('nz_photos')) || {};
function persistPhotos(){ return safeSetItem('nz_photos', photoStore); }

/* 景點封面：使用者可指定某張照片（或原始配圖）作為主要亮點卡片的封面，
   而不是每次上傳新照片就自動覆蓋原本的封面 */
let coverStore = JSON.parse(localStorage.getItem('nz_covers')) || {};
function persistCover(){ safeSetItem('nz_covers', coverStore); }
function setCoverPhoto(key, sel) {
  coverStore[key] = sel;
  persistCover();
  renderDayContent();
  setTimeout(()=>{ const card = document.getElementById('spot-card-'+key); if(card) card.classList.add('open'); }, 50);
}

/* 自訂新增景點：依「天」儲存在 LocalStorage，重新整理後仍會保留 */
let customSpotsStore = JSON.parse(localStorage.getItem('nz_custom_spots')) || {};
function persistCustomSpots(){ safeSetItem('nz_custom_spots', customSpotsStore); }
function getCustomSpots(dayIdx){ return customSpotsStore[dayIdx] || []; }

/* 依關鍵字與分類，自動組出一段景點簡介（離線生成，不需要網路，句型會隨機變化避免制式感） */
function generateAutoDesc(name, catKey, keywordsStr, dur){
  const c = CAT[catKey] || CAT.attraction;
  const kws = (keywordsStr||'').split(/[,，、]/).map(s=>s.trim()).filter(Boolean);
  const pick = arr => arr[Math.floor(Math.random()*arr.length)];

  const openers = {
    food: [`提到在地美食，「${name}」是您這趟旅程特別記下的一站`, `「${name}」是您收藏進口袋名單的用餐選擇`, `說到用餐，「${name}」是您這次特別想去嘗試的地方`],
    activity: [`「${name}」是您安排在行程中的一段體驗`, `「${name}」被您加進了這次的戶外／步道行程`, `這次行程中，「${name}」是您特別想安排的活動`],
    shopping: [`「${name}」是您順路想去逛逛的採購點`, `「${name}」被您列進了這趟旅程的購物清單`, `逛街採買方面，「${name}」是您特別留意到的地方`],
    attraction: [`「${name}」是您私房收藏的景點`, `「${name}」被您加進了這趟旅程的必訪名單`, `這次行程中，「${name}」是您特別想造訪的地方`],
    hotel: [`「${name}」是您這晚安排的住宿／休憩地點`, `「${name}」被您排進了這趟旅程的住宿清單`],
    transport: [`「${name}」是您這段行程安排的交通方式`, `「${name}」是您這趟旅程的交通安排之一`],
  };

  const kwSentence = kws.length
    ? (kws.length > 1
        ? `聽說這裡以「${kws.join('、')}」最受喜愛，很值得留意。`
        : `聽說這裡因「${kws[0]}」讓人印象深刻，很值得留意。`)
    : '';

  const closers = {
    food: ['實際營業時間與是否需要訂位，建議出發前再次確認。', '尖峰用餐時段可能需要稍候，建議預留一點彈性時間。', '若人氣較高，建議提早前往或先查詢是否可訂位。'],
    activity: ['出發前建議留意當天天氣與路況，並穿著合適的鞋子。', '建議依體力與時間彈性調整走訪範圍與路線。', '建議事先查詢開放時間與難易度，安排合適的時段前往。'],
    shopping: ['記得留意營業時間，也保留一點伴手禮預算。', '若剛好順路，很適合安排在移動途中稍作停留。', '建議先查一下營業時間，避免撲空。'],
    attraction: ['可依現場狀況彈性安排拍照與停留時間。', '建議留意人潮與光線，安排合適的造訪時段。', '建議事先查詢是否需要預約或有開放時間限制。'],
    hotel: ['記得提前確認入住與退房時間，以及辦理入住的方式。', '建議提前查看周邊生活機能與停車資訊。'],
    transport: ['建議提前確認實際時刻表與轉乘方式。', '建議預留緩衝時間，避免銜接過於緊湊。'],
  };

  const durSentence = dur ? `這裡建議停留${dur}左右。` : '';
  const full = `${pick(openers[catKey] || openers.attraction)}。${kwSentence}${durSentence}${pick(closers[catKey] || closers.attraction)}`;
  const short = `您親自新增的私房${c.label}景點${kws.length ? '，以「'+kws.join('、')+'」最受期待' : ''}。`;
  return {short, full};
}

/* 嘗試連網搜尋景點資料並生成簡介：這個功能只有在 Claude 對話介面「即時建立的 Artifact 畫布」中才能連線；
   本檔案是以可下載的靜態網頁形式提供，不論是在預覽或下載後開啟，通常都無法連上 Anthropic 伺服器，
   會自動改用上面經過強化的離線生成版本，不會中斷操作 */
async function generateAutoDescOnline(name, catKey, keywordsStr, dur){

  const c = CAT[catKey] || CAT.attraction;
  const kws = (keywordsStr||'').trim();
  const searchHint = kws ? `搜尋時請把「${name}」與關鍵字「${kws}」一起考慮，找出跟這些關鍵字最相關的資訊。` : `請直接搜尋「${name}」這個名稱找相關資訊。`;
  const prompt = `請使用網路搜尋工具，查詢紐西蘭南島「${name}」這個${c.label}的公開資訊。${searchHint}找到資料後，用繁體中文寫一段約80–120字、適合放進旅遊行程App的景點簡介，語氣自然口語、不要條列式，盡量帶入搜尋到的具體特色（不要只寫「以...聞名」這類空泛說法）。${dur ? '可自然帶入建議停留時間「'+dur+'」，':''}只回傳簡介本文，不要加前言、引號或任何說明文字。若確實搜尋不到這個名稱的公開資訊，才依名稱、分類與關鍵字合理推測寫一段通用但得體的簡介。`;
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
      tools: [{ type: 'web_search_20250305', name: 'web_search' }]
    })
  });
  if(!resp.ok) throw new Error('API 回應失敗：' + resp.status);
  const data = await resp.json();
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  if(!text) throw new Error('沒有取得簡介文字');
  const short = text.length > 44 ? text.slice(0, 44) + '…' : text;
  return { short, full: text };
}

async function addCustomSpot(dayIdx){
  const nameEl = document.getElementById('newSpotName-'+dayIdx);
  const catEl = document.getElementById('newSpotCat-'+dayIdx);
  const kwEl = document.getElementById('newSpotKw-'+dayIdx);
  const durEl = document.getElementById('newSpotDur-'+dayIdx);
  const btnEl = document.getElementById('addSpotBtn-'+dayIdx);
  const statusEl = document.getElementById('addSpotStatus-'+dayIdx);
  const name = nameEl.value.trim();
  if(!name){ nameEl.focus(); return; }
  const catKey = catEl.value;
  const kw = kwEl.value;
  const dur = durEl.value.trim();

  if(btnEl){ btnEl.disabled = true; btnEl.textContent = '🔍 搜尋景點資料中...'; }
  if(statusEl){ statusEl.textContent = '正在嘗試連網搜尋「'+name+'」的公開資訊，若無法連線將自動改用簡易生成…'; }

  let short, full, genSource;
  try {
    const online = await generateAutoDescOnline(name, catKey, kw, dur);
    short = online.short; full = online.full; genSource = 'online';
  } catch(err) {
    console.warn('連網生成簡介失敗，改用離線生成：', err);
    const offline = generateAutoDesc(name, catKey, kw, dur);
    short = offline.short; full = offline.full; genSource = 'offline';
  }

  const spot = S(name, catKey, short, { fullDesc: full, dur: dur || null, genSource });
  if(!customSpotsStore[dayIdx]) customSpotsStore[dayIdx] = [];
  customSpotsStore[dayIdx].push(spot);
  persistCustomSpots();
  nameEl.value=''; kwEl.value=''; durEl.value='';
  renderDayContent();
  updateSpotCount();
}
function delCustomSpot(dayIdx, i){
  if(!customSpotsStore[dayIdx]) return;
  customSpotsStore[dayIdx].splice(i,1);
  persistCustomSpots();
  renderDayContent();
  updateSpotCount();
}
function toggleEditSpot(idx){
  const el = document.getElementById('spot-edit-'+idx);
  if(el) el.style.display = (el.style.display === 'none' || !el.style.display) ? 'block' : 'none';
}
function saveSpotEdit(dayIdx, i, idx){
  if(!customSpotsStore[dayIdx] || !customSpotsStore[dayIdx][i]) return;
  const shortEl = document.getElementById('spot-edit-short-'+idx);
  const fullEl = document.getElementById('spot-edit-full-'+idx);
  const spot = customSpotsStore[dayIdx][i];
  const newShort = shortEl ? shortEl.value.trim() : '';
  const newFull = fullEl ? fullEl.value.trim() : '';
  if(newShort) spot.desc = newShort;
  if(newFull) spot.fullDesc = newFull;
  spot.genSource = 'edited';
  persistCustomSpots();
  renderDayContent();
  updateSpotCount();
}
function updateSpotCount(){
  let total = days.reduce((a,d)=>a+d.spots.length + (d.moreSpots?d.moreSpots.length:0),0);
  Object.values(customSpotsStore).forEach(arr => total += arr.length);
  document.getElementById('spotCount').textContent = total;
}

/* ============ 景點排序 (LocalStorage 永久保存) ============ */
const MAIN_CATS = ['attraction','activity','transport'];
const LIFE_CATS = ['food','shopping','hotel'];
let orderStore = JSON.parse(localStorage.getItem('nz_order')) || {};
function persistOrder(){ safeSetItem('nz_order', orderStore); }
function getOrderKey(dayIdx, listType){ return dayIdx + '-' + listType; }

function getNaturalList(dayIdx, listType){
  const d = days[dayIdx];
  const customSpots = getCustomSpots(dayIdx);
  const cats = listType === 'main' ? MAIN_CATS : LIFE_CATS;
  const allFixed = d.spots.map((s,i)=>({spot:s, key:`d${dayIdx}-m${i}`}))
    .concat((d.moreSpots||[]).map((s,i)=>({spot:s, key:`d${dayIdx}-s${i}`})));
  const allCustom = customSpots.map((s,i)=>({spot:s, key:`d${dayIdx}-c${i}`, customMeta:{dayIdx, i}}));
  return allFixed.filter(o=>cats.includes(o.spot.cat)).concat(allCustom.filter(o=>cats.includes(o.spot.cat)));
}

function applyOrder(dayIdx, listType, list){
  const okey = getOrderKey(dayIdx, listType);
  const naturalKeys = list.map(o=>o.key);
  let order = orderStore[okey];
  if(!order || !order.length) return list;
  order = order.filter(k=>naturalKeys.includes(k));
  naturalKeys.forEach(k=>{ if(!order.includes(k)) order.push(k); });
  const byKey = {}; list.forEach(o=>byKey[o.key]=o);
  return order.map(k=>byKey[k]).filter(Boolean);
}

function moveSpot(dayIdx, listType, key, dir){
  const natural = getNaturalList(dayIdx, listType);
  const naturalKeys = natural.map(o=>o.key);
  const okey = getOrderKey(dayIdx, listType);
  let order = orderStore[okey];
  if(!order || !order.length) order = naturalKeys.slice();
  else {
    order = order.filter(k=>naturalKeys.includes(k));
    naturalKeys.forEach(k=>{ if(!order.includes(k)) order.push(k); });
  }
  const i = order.indexOf(key);
  const j = i + dir;
  if(i < 0 || j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  orderStore[okey] = order;
  persistOrder();
  renderDayContent();
}

/* ============ 景點內「資訊與評論」區塊排序 (LocalStorage 永久保存) ============ */
let blockOrderStore = JSON.parse(localStorage.getItem('nz_block_order')) || {};
function persistBlockOrder(){ safeSetItem('nz_block_order', blockOrderStore); }
function moveBlock(spotKey, blockId, dir, hasBadges, hasInfo){
  const naturalIds = [];
  if(hasBadges) naturalIds.push('badges');
  if(hasInfo) naturalIds.push('info');
  naturalIds.push('note');
  let order = blockOrderStore[spotKey];
  if(!order || !order.length) order = naturalIds.slice();
  else {
    order = order.filter(id=>naturalIds.includes(id));
    naturalIds.forEach(id=>{ if(!order.includes(id)) order.push(id); });
  }
  const i = order.indexOf(blockId);
  const j = i + dir;
  if(i < 0 || j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  blockOrderStore[spotKey] = order;
  persistBlockOrder();
  renderDayContent();
}


let routeMapStore = JSON.parse(localStorage.getItem('nz_route_maps')) || {};
function persistRouteMaps(){ safeSetItem('nz_route_maps', routeMapStore); }
function handleRouteMapUpload(e, dayIdx){
  const files = Array.from(e.target.files || []);
  if(!routeMapStore[dayIdx]) routeMapStore[dayIdx] = [];
  Promise.all(files.map(fileToDataURL)).then(dataUrls=>{
    routeMapStore[dayIdx].push(...dataUrls);
    persistRouteMaps();
    renderDayContent();
  });
}
function removeRouteMap(dayIdx, i){
  if(!routeMapStore[dayIdx]) return;
  routeMapStore[dayIdx].splice(i, 1);
  persistRouteMaps();
  renderDayContent();
}

/* ============ RENDER: ITINERARY ============ */
const dayScroll = document.getElementById('dayScroll');
const dayContent = document.getElementById('dayContent');
let activeDay = 0;

function mapsLink(name){ return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(name + ' New Zealand'); }

function renderDayChips(){
  dayScroll.innerHTML = days.map((d,i)=>`
    <div class="day-chip ${i===activeDay?'active':''}" data-i="${i}" onclick="setActiveDay(${i})">
      <div class="d">${d.date}</div>
      <div class="m">週${d.weekday}</div>
    </div>`).join('');
}

let activeSubTabStore = {}; /* dayIdx -> 'main' | 'more' | 'routemap'，記住使用者目前停留在哪個子分頁 */

function setActiveDay(i) {
  activeDay = i;
  renderDayChips();
  renderDayContent();
  document.getElementById('view-itinerary').scrollIntoView({behavior:'smooth', block:'start'});
}

function toggleSpotDetails(key) {
  const card = document.getElementById('spot-card-'+key);
  if(card) card.classList.toggle('open');
}

function spotCardHTML(spot, key, isMainSpot, customMeta, orderInfo){
  const idx = key;
  const c = CAT[spot.cat];
  const badges = [];
  if(spot.tags){
    spot.tags.forEach(t=>{
      if(t==='必吃') badges.push('<span class="badge b-eat">🍴 必吃</span>');
      if(t==='必買') badges.push('<span class="badge b-buy">🎁 必買</span>');
      if(t==='必拍') badges.push('<span class="badge b-photo">📸 必拍</span>');
    });
  }
  
  const infoBits = [];
  if(spot.dur) infoBits.push(`<div class="info-item"><div class="k">建議停留</div><div class="v">${spot.dur}</div></div>`);
  if(spot.hours) infoBits.push(`<div class="info-item"><div class="k">營業/開放時間</div><div class="v" style="color:#2f8a52;">${spot.hours}</div></div>`);
  if(spot.note) infoBits.push(`<div class="info-item" style="grid-column: 1 / -1;"><div class="k">重要提點 / 門票</div><div class="v" style="font-weight:500; font-size:11.5px; color:#c1502f;">${spot.note}</div></div>`);
  
  const userPhotos = photoStore[idx] || [];
  let thumbImgs = userPhotos.length > 0 ? userPhotos : (spot.img ? [spot.img] : []);
  const thumbImgsAreUserPhotos = userPhotos.length > 0;

  /* 封面：預設優先使用原本配圖（不會被新上傳的照片自動蓋掉），
     使用者可在照片區點「設為封面」自行指定要用哪一張（含步道地圖、菜單翻譯等也不會被誤認成封面） */
  const coverSel = coverStore[idx];
  let bg;
  if (coverSel === 'original' && spot.img) bg = spot.img;
  else if (typeof coverSel === 'number' && userPhotos[coverSel]) bg = userPhotos[coverSel];
  else bg = spot.img || userPhotos[0] || 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/90/Lake_Hawea_New_Zealand.jpg/640px-Lake_Hawea_New_Zealand.jpg';

  /* 使用者新增的資訊：可新增多筆，各自獨立刪除，不會互相覆蓋 */
  let userNotes = notesStore[idx] || [];
  let notesListHTML = userNotes.length ? userNotes.map((n,ni)=>`<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; margin-top:6px; padding-top:6px; border-top:1px dashed rgba(0,0,0,0.12);"><span style="flex:1; white-space:pre-line;">${n}</span><button onclick="event.stopPropagation(); deleteNote('${idx}', ${ni})" style="background:none; border:none; color:#c1502f; cursor:pointer; font-size:11px; flex:none; padding:0 0 0 4px;">✕</button></div>`).join('') : '';
  let displayInfo = '';
  if (spot.customInfo) displayInfo += spot.customInfo;
  if (notesListHTML) displayInfo += `<div style="margin-top:${spot.customInfo ? '8px' : '0'};"><span style="color:#6b7686; font-weight:700; font-size:11px;">✏️ 您新增的資訊：</span>${notesListHTML}</div>`;

  let customInfoBox = '';
  if (displayInfo) {
    customInfoBox = `<div class="custom-info-box" onclick="event.stopPropagation()"><b>💡 資訊與筆記：</b><br>${displayInfo}<button onclick="toggleEditNote(event, '${idx}')" style="position:absolute; top:8px; right:8px; background:none; border:none; cursor:pointer; font-size:12px; opacity:0.6;">➕ 新增</button></div>`;
  }

  let noteEditArea = `<div class="note-edit-area" style="margin-top:10px; display:none;" id="edit-note-${idx}" onclick="event.stopPropagation()"><textarea id="note-input-${idx}" placeholder="新增一筆攻略、必點菜單或提醒...（可重複新增多筆）" style="width:100%; border:1px solid var(--line); border-radius:8px; padding:8px; font-size:12px; font-family:inherit; resize:vertical; min-height:60px; outline:none; margin-bottom:6px;"></textarea><div style="display:flex; gap:6px;"><button onclick="addNote('${idx}')" style="padding:6px 14px; font-size:11px; background:var(--blue); color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:700;">💾 新增這筆</button><button onclick="toggleEditNote(event, '${idx}')" style="padding:6px 14px; font-size:11px; background:#f2f3ec; color:var(--ink); border:none; border-radius:6px; cursor:pointer; font-weight:700;">收合</button></div></div>${!displayInfo ? `<button class="btn-note-toggle" onclick="toggleEditNote(event, '${idx}')" style="background:transparent; border:1px dashed #c1c8cf; border-radius:999px; padding:6px 12px; font-size:11.5px; color:#6b7686; cursor:pointer; font-family:inherit; margin-top:6px; margin-bottom:10px;" id="btn-note-${idx}">➕ 添加評論或資訊</button>` : ''}`;

  let miniStripHTML = thumbImgs.length > 0 ? `<div class="mini-photo-strip" onclick="event.stopPropagation();">` + thumbImgs.map((u, i) => `<div style="position:relative; display:inline-block;"><img src="${u}" onclick="openAttachModal('${u}')">${thumbImgsAreUserPhotos ? `<button onclick="removePhoto(event, '${idx}', ${i})" style="position:absolute; top:2px; right:2px; background:rgba(0,0,0,0.5); color:#fff; border:none; border-radius:50%; width:16px; height:16px; font-size:8px; cursor:pointer;">✕</button>` : ''}</div>`).join('') + `</div>` : '';

  /* 照片區：主要亮點卡片會列出「原始配圖 + 所有使用者上傳的照片」，並可個別指定作為封面；
     次要（食衣住）景點沒有封面概念，維持原本只顯示使用者照片的邏輯 */
  let pStrip = '';
  if (isMainSpot) {
    const galleryEntries = [];
    if (spot.img) galleryEntries.push({url: spot.img, sel: 'original'});
    userPhotos.forEach((u, i) => galleryEntries.push({url: u, sel: i}));
    if (galleryEntries.length) {
      pStrip = `<div class="photo-strip" onclick="event.stopPropagation()">` + galleryEntries.map(g => {
        const isCover = g.url === bg;
        const selArg = (typeof g.sel === 'string') ? `'${g.sel}'` : g.sel;
        const coverTag = isCover
          ? `<span style="position:absolute; bottom:3px; left:3px; right:3px; background:var(--blue); color:#fff; font-size:8.5px; font-weight:700; padding:2px 3px; border-radius:5px; text-align:center; line-height:1.3;">★ 封面</span>`
          : `<button onclick="event.stopPropagation(); setCoverPhoto('${idx}', ${selArg})" style="position:absolute; bottom:3px; left:3px; right:3px; background:rgba(0,0,0,.6); color:#fff; border:none; font-size:8.5px; font-weight:700; padding:2px 3px; border-radius:5px; cursor:pointer; line-height:1.3;">設為封面</button>`;
        const removeBtn = (g.sel !== 'original')
          ? `<button onclick="removePhoto(event, '${idx}', ${g.sel})" style="position:absolute; top:2px; right:2px; background:rgba(0,0,0,0.5); color:#fff; border:none; border-radius:50%; width:20px; height:20px; font-size:10px; cursor:pointer;">✕</button>`
          : '';
        return `<div class="photo-item-wrap"><img src="${g.url}" onclick="openAttachModal('${g.url}')">${removeBtn}${coverTag}</div>`;
      }).join('') + `</div>`;
    }
  } else {
    pStrip = (userPhotos.length) ? `<div class="photo-strip" onclick="event.stopPropagation()">` + userPhotos.map((u, i)=>`<div class="photo-item-wrap"><img src="${u}" onclick="openAttachModal('${u}')"><button onclick="removePhoto(event, '${idx}', ${i})" style="position:absolute; top:2px; right:2px; background:rgba(0,0,0,0.5); color:#fff; border:none; border-radius:50%; width:20px; height:20px; font-size:10px; cursor:pointer;">✕</button></div>`).join('') + `</div>` : '';
  }

  const badgesHTML = badges.length ? `<div class="badges" style="margin-bottom:6px;">${badges.join('')}</div>` : '';
  const infoHTML = infoBits.length ? `<div class="info-grid">${infoBits.join('')}</div>` : '';
  const noteHTML = `${customInfoBox}${noteEditArea}`;
  const blockDefs = [];
  if(badgesHTML) blockDefs.push({id:'badges', html: badgesHTML});
  if(infoHTML) blockDefs.push({id:'info', html: infoHTML});
  blockDefs.push({id:'note', html: noteHTML});
  const naturalBlockIds = blockDefs.map(b=>b.id);
  let blockOrder = blockOrderStore[idx];
  if(blockOrder && blockOrder.length){
    blockOrder = blockOrder.filter(id=>naturalBlockIds.includes(id));
    naturalBlockIds.forEach(id=>{ if(!blockOrder.includes(id)) blockOrder.push(id); });
  } else {
    blockOrder = naturalBlockIds.slice();
  }
  const byBlockId = {}; blockDefs.forEach(b=>byBlockId[b.id]=b);
  const orderedBlocks = blockOrder.map(id=>byBlockId[id]).filter(Boolean);
  const hasBadgesFlag = badgesHTML ? 'true' : 'false';
  const hasInfoFlag = infoHTML ? 'true' : 'false';
  const reorderableBlocksHTML = orderedBlocks.map((b,pos)=>{
    const upBtn = pos > 0 ? `<button onclick="event.stopPropagation(); moveBlock('${idx}','${b.id}',-1,${hasBadgesFlag},${hasInfoFlag})" style="background:#eef1e6; border:none; cursor:pointer; font-size:10px; color:#9aa3ad; padding:2px 6px; border-radius:5px;">⬆</button>` : '';
    const downBtn = pos < orderedBlocks.length - 1 ? `<button onclick="event.stopPropagation(); moveBlock('${idx}','${b.id}',1,${hasBadgesFlag},${hasInfoFlag})" style="background:#eef1e6; border:none; cursor:pointer; font-size:10px; color:#9aa3ad; padding:2px 6px; border-radius:5px;">⬇</button>` : '';
    return (orderedBlocks.length > 1 ? `<div style="display:flex; justify-content:flex-end; gap:4px; margin:2px 0;">${upBtn}${downBtn}</div>` : '') + b.html;
  }).join('');

  const genLabel = spot.genSource === 'edited' ? '✏️ 簡介已由您編輯' : (spot.genSource === 'online' ? '🔍 簡介已透過網路搜尋生成' : (spot.genSource === 'offline' ? '📝 簡介為簡易生成（未連上網路）' : '🆕 自訂景點'));
  const orderBtns = orderInfo ? `<button onclick="event.stopPropagation(); moveSpot(${orderInfo.dayIdx}, '${orderInfo.listType}', '${idx}', -1)" style="background:#eef1e6; color:var(--ink-soft); border:none; padding:4px 9px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer;">⬆ 上移</button><button onclick="event.stopPropagation(); moveSpot(${orderInfo.dayIdx}, '${orderInfo.listType}', '${idx}', 1)" style="background:#eef1e6; color:var(--ink-soft); border:none; padding:4px 9px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer;">⬇ 下移</button>` : '';
  const delBtn = customMeta ? `<button onclick="event.stopPropagation(); delCustomSpot(${customMeta.dayIdx}, ${customMeta.i})" style="background:#fff0ec; color:#c1502f; border:none; padding:4px 10px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; white-space:nowrap;">🗑️ 刪除此景點</button>` : '';
  const editBtn = customMeta ? `<button onclick="event.stopPropagation(); toggleEditSpot('${idx}')" style="background:#eef3fb; color:var(--blue); border:none; padding:4px 10px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; white-space:nowrap;">✏️ 編輯簡介</button>` : '';
  const customBar = (customMeta || orderInfo) ? `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; gap:8px; flex-wrap:wrap;"><span style="display:flex; gap:6px; flex-wrap:wrap;">${customMeta ? `<span class="badge" style="background:#eef3fb; color:var(--blue);">${genLabel}</span>` : ''}</span><span style="display:flex; gap:6px; flex-wrap:wrap;">${orderBtns}${editBtn}${delBtn}</span></div>` : '';
  const editSpotAreaHTML = customMeta ? `<div id="spot-edit-${idx}" style="display:none; margin-bottom:10px; background:#f7f9fc; border:1px dashed #c7d6ea; border-radius:8px; padding:10px;" onclick="event.stopPropagation()">
      <div style="font-size:11px; font-weight:700; color:var(--ink-soft); margin-bottom:4px;">簡短介紹（列表中顯示）</div>
      <textarea id="spot-edit-short-${idx}" style="width:100%; border:1px solid var(--line); border-radius:6px; padding:6px; font-size:12px; font-family:inherit; resize:vertical; min-height:40px; outline:none; margin-bottom:8px; box-sizing:border-box;">${(spot.desc||'').replace(/</g,'&lt;')}</textarea>
      <div style="font-size:11px; font-weight:700; color:var(--ink-soft); margin-bottom:4px;">完整簡介（展開後顯示）</div>
      <textarea id="spot-edit-full-${idx}" style="width:100%; border:1px solid var(--line); border-radius:6px; padding:6px; font-size:12px; font-family:inherit; resize:vertical; min-height:80px; outline:none; margin-bottom:8px; box-sizing:border-box;">${(spot.fullDesc||spot.desc||'').replace(/</g,'&lt;')}</textarea>
      <div style="display:flex; gap:6px;">
        <button onclick="saveSpotEdit(${customMeta.dayIdx}, ${customMeta.i}, '${idx}')" style="padding:6px 14px; font-size:11px; background:var(--blue); color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:700;">💾 儲存</button>
        <button onclick="toggleEditSpot('${idx}')" style="padding:6px 14px; font-size:11px; background:#f2f3ec; color:var(--ink); border:none; border-radius:6px; cursor:pointer; font-weight:700;">取消</button>
      </div>
    </div>` : '';

  if (!isMainSpot) {
    return `<div class="sub-spot-card" id="spot-card-${idx}"><div class="sub-spot-header" onclick="toggleSpotDetails('${idx}')"><div class="sub-spot-header-content"><h4>${spot.name}</h4><p class="short-desc">${spot.desc}</p>${miniStripHTML}</div><div class="chevron">▼</div></div><div class="sub-spot-details-wrap"><div class="sub-spot-details" onclick="event.stopPropagation()">${customBar}${editSpotAreaHTML}<p class="full-desc">${spot.fullDesc || spot.desc}</p>${spot.recDishes ? `<div class="dish-tag">🍲 必點推薦：${spot.recDishes}</div>` : ''}${reorderableBlocksHTML}<div class="action-row" style="margin-top:10px;"><a class="btn btn-map" href="${mapsLink(spot.name)}" target="_blank" rel="noopener">🗺️ 導航</a>${spot.link ? `<a class="btn btn-photo" href="${spot.link}" target="_blank" rel="noopener">🔗 ${spot.linkLabel}</a>` : ''}<button class="btn btn-photo" onclick="document.getElementById('file-${idx}').click()">📷 上傳照片</button></div><input type="file" accept="image/*" id="file-${idx}" style="display:none" multiple onchange="handlePhoto(event, '${idx}')">${pStrip}</div></div></div>`;
  }

  return `<div class="guide-card" id="spot-card-${idx}"><div class="guide-header" style="background-image:url('${bg}');" onclick="toggleSpotDetails('${idx}')">${photoStore[idx] && photoStore[idx].length > 0 ? `<span class="own-badge" onclick="event.stopPropagation(); document.getElementById('file-${idx}').click()">✅ 已有你的實拍照片</span>` : `<button class="own-badge" style="border:none; cursor:pointer;" onclick="event.stopPropagation(); document.getElementById('file-${idx}').click()">📷 新增我的照片</button>`}<div class="guide-header-content"><span class="cat-label ${c.cls}">${c.emoji} ${c.label}</span><h3>${spot.name}</h3><p class="short-desc">${spot.desc}</p></div><div class="chevron">▼</div></div><div class="guide-details-wrap"><div class="guide-details" onclick="event.stopPropagation()">${customBar}${editSpotAreaHTML}<p class="full-desc">${spot.fullDesc || spot.desc}</p>${reorderableBlocksHTML}${spot.tip?`<div class="tip-box"><b>📸 拍照與自駕小解密：</b>${spot.tip}</div>`:''}${spot.docMap?`<div class="tip-box" style="background: linear-gradient(120deg,#e8f8ee,#fff); border-color:#8fd6c3; color:#22513f;"><b>🗺️ DOC 官方步道地圖與狀態：</b><a href="${spot.docMap}" target="_blank" rel="noopener" style="color:var(--blue); font-weight:700; text-decoration:underline;">點此開啟</a></div>`:''}${spot.park?`<div class="park-box"><b>🅿️ 停車＆自駕補給：</b>${spot.park}</div>`:''}<div class="action-row" style="margin-top:10px;"><a class="btn btn-map" href="${mapsLink(spot.name)}" target="_blank" rel="noopener">🗺️ 導航導出</a>${spot.link ? `<a class="btn btn-photo" href="${spot.link}" target="_blank" rel="noopener">🔗 ${spot.linkLabel}</a>` : ''}<button class="btn btn-photo" onclick="document.getElementById('file-${idx}').click()">📷 上傳照片</button></div><input type="file" accept="image/*" id="file-${idx}" style="display:none" multiple onchange="handlePhoto(event, '${idx}')">${pStrip}</div></div></div>`;
}

/* 讀取檔案並自動壓縮：長邊限制在 1600px、轉存為 JPEG(品質0.82)，
   一般手機相片可從 3-8MB 壓到數百KB，大幅降低 localStorage 塞滿導致上傳失敗的機率。
   若圖片無法被瀏覽器解碼（極少數情況），則退回存原始檔案。 */
function fileToDataURL(file){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = () => {
      const rawDataUrl = reader.result;
      const img = new Image();
      img.onload = () => {
        try {
          const MAX_DIM = 1600;
          let w = img.naturalWidth, h = img.naturalHeight;
          if (w > MAX_DIM || h > MAX_DIM) {
            if (w > h) { h = Math.round(h * MAX_DIM / w); w = MAX_DIM; }
            else { w = Math.round(w * MAX_DIM / h); h = MAX_DIM; }
          }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        } catch(err) {
          resolve(rawDataUrl);
        }
      };
      img.onerror = () => resolve(rawDataUrl);
      img.src = rawDataUrl;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
function handlePhoto(e, idx){
  const files = Array.from(e.target.files || []);
  if(!photoStore[idx]) photoStore[idx] = [];
  Promise.all(files.map(fileToDataURL)).then(dataUrls=>{
    photoStore[idx].push(...dataUrls);
    persistPhotos();
    renderDayContent();
    setTimeout(()=>{ const card = document.getElementById('spot-card-'+idx); if(card) card.classList.add('open'); }, 50);
  });
  e.target.value = '';
}
function removePhoto(e, idx, photoIdx) {
  e.stopPropagation();
  photoStore[idx].splice(photoIdx, 1);
  const sel = coverStore[idx];
  if (typeof sel === 'number') {
    if (sel === photoIdx) delete coverStore[idx];
    else if (sel > photoIdx) coverStore[idx] = sel - 1;
    persistCover();
  }
  persistPhotos();
  renderDayContent();
  setTimeout(()=>{ const card = document.getElementById('spot-card-'+idx); if(card) card.classList.add('open'); }, 50);
}

function openAttachModal(src) {
  document.getElementById('attachModalImg').src = src;
  document.getElementById('attachModal').classList.add('active');
}
function closeAttachModal() { document.getElementById('attachModal').classList.remove('active'); }

function switchSubTab(dayIdx, tabType) {
  activeSubTabStore[dayIdx] = tabType;
  const container = document.getElementById(`day-card-${dayIdx}`);
  if (!container) return;
  container.querySelectorAll('.spot-subtab').forEach(btn => btn.classList.toggle('active', btn.dataset.type === tabType));
  container.querySelectorAll('.subtab-content').forEach(content => content.classList.toggle('active', content.dataset.type === tabType));
}

function renderDayContent(){
  const d = days[activeDay];
  const curSubTab = activeSubTabStore[activeDay] || 'main';

  const mainList = applyOrder(activeDay, 'main', getNaturalList(activeDay, 'main'));
  const lifeList = applyOrder(activeDay, 'life', getNaturalList(activeDay, 'life'));

  let mainSpotsHTML = mainList.map(o=>spotCardHTML(o.spot, o.key, true, o.customMeta, {dayIdx:activeDay, listType:'main'})).join('');
  if(!mainSpotsHTML) mainSpotsHTML = '<div class="empty">此區域今天暫無排定主要亮點。</div>';

  let secondaryCardsHTML = lifeList.map(o=>spotCardHTML(o.spot, o.key, false, o.customMeta, {dayIdx:activeDay, listType:'life'})).join('');
  if(!secondaryCardsHTML) secondaryCardsHTML = '<div class="empty">此區域今天暫無排定食衣住項目，歡迎在下方新增您的私房景點。</div>';

  const addSpotFormHTML = `
    <div class="section-card" style="margin-top:4px;">
      <h3 style="margin:0 0 10px;">✨ 新增我的私房景點</h3>
      <div style="display:flex; flex-direction:column; gap:8px;">
        <input type="text" id="newSpotName-${activeDay}" placeholder="景點名稱（必填）" style="padding:10px 12px; border:1px solid var(--line); border-radius:8px; font-family:inherit; font-size:13px;">
        <select id="newSpotCat-${activeDay}" style="padding:10px 12px; border:1px solid var(--line); border-radius:8px; font-family:inherit; font-size:13px;">
          ${Object.keys(CAT).map(k=>`<option value="${k}">${CAT[k].emoji} ${CAT[k].label}</option>`).join('')}
        </select>
        <input type="text" id="newSpotKw-${activeDay}" placeholder="關鍵字，如：夜景、羊駝、手作巧克力（可留空）" style="padding:10px 12px; border:1px solid var(--line); border-radius:8px; font-family:inherit; font-size:13px;">
        <input type="text" id="newSpotDur-${activeDay}" placeholder="建議停留時間，如：約1小時（可留空）" style="padding:10px 12px; border:1px solid var(--line); border-radius:8px; font-family:inherit; font-size:13px;">
        <button id="addSpotBtn-${activeDay}" onclick="addCustomSpot(${activeDay})" style="background:linear-gradient(135deg, var(--blue), #7fa0f0); color:#fff; border:none; padding:11px; border-radius:999px; font-family:inherit; font-size:13px; font-weight:700; cursor:pointer;">＋ 新增並自動生成簡介</button>
      </div>
      <div style="font-size:11px; color:var(--ink-soft); margin-top:8px; line-height:1.5;" id="addSpotStatus-${activeDay}">新增後會依景點名稱與關鍵字自動組出一段簡介（句型會隨機變化），並嘗試連網搜尋補充更具體的資訊——但這個檔案是可下載的靜態網頁，連網搜尋通常無法成功，實際上多半會使用自動組成的版本。之後仍可在景點卡片中補充您的個人筆記。</div>
    </div>`;

  const routeMaps = routeMapStore[activeDay] || [];
  const routeMapGalleryHTML = routeMaps.length ? `<div class="mini-photo-strip" style="margin-bottom:14px;">${routeMaps.map((u,i)=>`<div style="position:relative; display:inline-block;"><img src="${u}" onclick="openAttachModal('${u}')"><button onclick="removeRouteMap(${activeDay}, ${i})" style="position:absolute; top:2px; right:2px; background:rgba(0,0,0,0.5); color:#fff; border:none; border-radius:50%; width:16px; height:16px; font-size:8px; cursor:pointer;">✕</button></div>`).join('')}</div>` : '<div class="empty">尚未上傳今天的行動路線圖。</div>';
  const routeMapHTML = `
    <div class="section-card" style="margin-top:4px;">
      <h3 style="margin:0 0 10px;">🗺️ 我的當日行動路線圖</h3>
      ${routeMapGalleryHTML}
      <button onclick="document.getElementById('routeMapFile-${activeDay}').click()" style="background:linear-gradient(135deg, var(--blue), #7fa0f0); color:#fff; border:none; padding:11px 16px; border-radius:999px; font-family:inherit; font-size:13px; font-weight:700; cursor:pointer;">📷 上傳路線圖</button>
      <input type="file" accept="image/*" id="routeMapFile-${activeDay}" style="display:none" multiple onchange="handleRouteMapUpload(event, ${activeDay})">
      <div style="font-size:11px; color:var(--ink-soft); margin-top:8px; line-height:1.5;">可上傳您自己規劃或手繪的當日路線圖／導航截圖，會保存在此裝置的瀏覽器中，重新整理或關閉頁面都不會消失。</div>
    </div>`;

  dayContent.innerHTML = `
    <div class="day-card-head">
      <div class="region">【Day ${d.dayNum}｜${d.date}】<br>${d.region}</div>
      ${d.drive ? `<div class="drive-info">${d.drive}</div>` : ''}
      ${d.gas ? `<div class="gas-info">${d.gas}</div>` : ''}
      <h2>${d.title}</h2>
      ${d.dayDesc ? `<div class="day-desc-box">${d.dayDesc}</div>` : ''}
      <div class="weather-strip"><div class="ico">${d.weatherIco}</div><div class="txt"><b style="font-family:'Zen Kaku Gothic New', sans-serif; font-size:14px;">${d.enRegion}</b><br><span style="font-size:11.5px; opacity:0.85;">${d.wear}</span></div></div>
      <div class="stay-line">🏡 ${d.spots.filter(s=>s.cat==='hotel').map(s=>s.name).join('、') || '—'}</div>
    </div>
    <div id="day-card-${activeDay}">
      <div class="spot-subtabs"><button class="spot-subtab${curSubTab==='main'?' active':''}" data-type="main" onclick="switchSubTab(${activeDay}, 'main')">📌 主要亮點 (${mainList.length})</button><button class="spot-subtab${curSubTab==='more'?' active':''}" data-type="more" onclick="switchSubTab(${activeDay}, 'more')">🍴 食衣住 (${lifeList.length})</button><button class="spot-subtab${curSubTab==='routemap'?' active':''}" data-type="routemap" onclick="switchSubTab(${activeDay}, 'routemap')">🗺️ 路線圖${routeMaps.length ? ` (${routeMaps.length})` : ''}</button></div>
      <div class="subtab-content${curSubTab==='main'?' active':''}" data-type="main">${mainSpotsHTML}</div>
      <div class="subtab-content${curSubTab==='more'?' active':''}" data-type="more" style="background:#f4f6f0; border-radius:0 0 var(--r-lg) var(--r-lg); padding:16px 12px 16px; margin-bottom:16px;">${secondaryCardsHTML}${addSpotFormHTML}</div>
      <div class="subtab-content${curSubTab==='routemap'?' active':''}" data-type="routemap" style="background:#f4f6f0; border-radius:0 0 var(--r-lg) var(--r-lg); padding:16px 12px 16px; margin-bottom:16px;">${routeMapHTML}</div>
    </div>
  `;
}

/* ============ RENDER: ENHANCED LIVE WEATHER & OUTFIT ============ */
const CITIES = {
  'Wanaka': {lat:-44.7000, lon:169.1500, label:'Wanaka'},
  'Tekapo': {lat:-44.0058, lon:170.4790, label:'Lake Tekapo'},
  'MtCook': {lat:-43.7340, lon:170.0960, label:'Mt Cook Village'},
  'Oamaru': {lat:-45.0966, lon:170.9700, label:'Oamaru'},
  'Dunedin': {lat:-45.8788, lon:170.5028, label:'Dunedin'},
  'TeAnau': {lat:-45.4131, lon:167.7186, label:'Te Anau'},
  'Queenstown': {lat:-45.0312, lon:168.6626, label:'Queenstown'},
};
const WMO = {
  0:['☀️','晴朗'],1:['🌤️','大致晴朗'],2:['⛅','局部多雲'],3:['☁️','多雲'],
  45:['🌫️','有霧'],48:['🌫️','霧淞'],
  51:['🌦️','毛毛雨'],53:['🌦️','毛毛雨'],55:['🌦️','強毛毛雨'],
  61:['🌧️','小雨'],63:['🌧️','中雨'],65:['🌧️','大雨'],
  71:['🌨️','小雪'],73:['🌨️','中雪'],75:['❄️','大雪'],
  80:['🌦️','陣雨'],81:['🌧️','強陣雨'],82:['⛈️','劇烈陣雨'],
  95:['⛈️','雷雨'],96:['⛈️','雷雨挾冰雹'],99:['⛈️','強雷雨挾冰雹'],
};
function wmoInfo(code){ return WMO[code] || ['🌡️','—']; }

function getDynamicTip(temp, code) {
  let tip = "";
  if(temp < 10) tip += "🌡️ 氣溫較低，建議穿著保暖防風衣物。";
  else if(temp > 20) tip += "🌡️ 氣溫舒適，可洋蔥式穿搭。";
  else tip += "🌡️ 氣溫涼爽，建議攜帶薄外套。";
  
  if([51,53,55,61,63,65,80,81,82,95,96,99].includes(code)) tip += " ☔ 有降雨機率，請務必攜帶雨具！";
  if([0,1,2].includes(code)) tip += " 🕶️ 紫外線較強，請注意防曬與配戴墨鏡。";
  if([71,73,75].includes(code)) tip += " ❄️ 降雪機率高，請注意保暖與行車安全！";
  return tip;
}

function getUVStars(uv) {
  if(!uv) return '未知';
  if(uv <= 2) return '★☆☆☆☆ (低)';
  if(uv <= 5) return '★★☆☆☆ (中)';
  if(uv <= 7) return '★★★☆☆ (高)';
  if(uv <= 10) return '★★★★☆ (甚高)';
  return '★★★★★ (極高)';
}

let liveWeatherCache = {};

/* ---- 天氣離線快取 (localStorage) ---- */
const WEATHER_CACHE_KEY = 'nz_weather_cache_v1';
function loadWeatherCache(){
  try{ return JSON.parse(localStorage.getItem(WEATHER_CACHE_KEY)) || {}; }catch(e){ return {}; }
}
function saveWeatherCacheEntry(k, entry){
  try{
    const cache = loadWeatherCache();
    cache[k] = entry;
    localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(cache));
  }catch(e){ /* storage full or unavailable, ignore */ }
}

async function fetchWeatherFor(k, attempt){
  const {lat, lon} = CITIES[k];
  const controller = new AbortController();
  const timeout = setTimeout(()=>controller.abort(), 9000);
  try{
    if(!navigator.onLine) throw new Error('OFFLINE');
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,wind_speed_10m,precipitation,weather_code&daily=sunrise,sunset,uv_index_max&timezone=Pacific%2FAuckland`, { signal: controller.signal });
    clearTimeout(timeout);
    if(!res.ok) throw new Error('HTTP '+res.status);
    const data = await res.json();
    liveWeatherCache[k] = { data, error:null, stale:false, fetchedAt: Date.now() };
    saveWeatherCacheEntry(k, liveWeatherCache[k]);
  }catch(err){
    clearTimeout(timeout);
    if(!attempt && navigator.onLine){
      await new Promise(r=>setTimeout(r, 1200));
      return fetchWeatherFor(k, 1);
    }
    const cached = loadWeatherCache()[k];
    if(cached && cached.data){
      liveWeatherCache[k] = { data: cached.data, error:null, stale:true, fetchedAt: cached.fetchedAt };
    } else {
      liveWeatherCache[k] = { data:null, error: (err && err.name === 'AbortError') ? '連線逾時' : (err && err.message === 'OFFLINE' ? '目前離線' : '連線失敗') };
    }
  }
  renderOneLiveCity(k);
}

/* ============ 即時衛星雲圖 (RainViewer 紅外線衛星影像) ============ */
let rainRadarMap = null;
let rainRadarLayer = null;
function initRainRadar(){
  const el = document.getElementById('rainRadarMap');
  if(!el || rainRadarMap || typeof L === 'undefined') return;
  rainRadarMap = L.map('rainRadarMap', {zoomControl:true}).setView([-44.7, 169.0], 6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors, © RainViewer',
    maxZoom: 12
  }).addTo(rainRadarMap);
  refreshRainRadar();
}
async function refreshRainRadar(){
  const timeEl = document.getElementById('rainRadarTime');
  if(!rainRadarMap){ initRainRadar(); return; }
  if(!navigator.onLine){
    if(timeEl) timeEl.textContent = '⚠️ 目前離線，無法取得最新衛星雲圖；地圖底圖若先前瀏覽過，離線時仍可能可用。';
    return;
  }
  if(timeEl) timeEl.textContent = '衛星雲圖抓取中...';
  try{
    const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
    if(!res.ok) throw new Error('HTTP '+res.status);
    const data = await res.json();
    const frames = data.satellite && data.satellite.infrared;
    if(!frames || !frames.length) throw new Error('無可用衛星雲圖影格');
    const latest = frames[frames.length-1];
    const tileUrl = `${data.host}${latest.path}/256/{z}/{x}/{y}/0/0_0.png`;
    if(rainRadarLayer) rainRadarMap.removeLayer(rainRadarLayer);
    rainRadarLayer = L.tileLayer(tileUrl, {opacity:0.75, maxZoom:12, attribution:'© RainViewer'}).addTo(rainRadarMap);
    if(timeEl) timeEl.textContent = '衛星雲圖更新於：' + new Date(latest.time * 1000).toLocaleString('zh-TW', {hour12:false});
  }catch(err){
    if(timeEl) timeEl.textContent = navigator.onLine ? '衛星雲圖取得失敗，請稍後點擊「重新整理雲圖」再試一次。' : '⚠️ 目前離線，無法取得最新衛星雲圖。';
  }
}

function renderWeatherFromCache(){
  const wrap = document.getElementById('liveWeatherList');
  if(!wrap) return;
  const cache = loadWeatherCache();
  const hasAny = Object.keys(CITIES).some(k=>cache[k] && cache[k].data);
  wrap.innerHTML = Object.keys(CITIES).map(k=>`<div class="weather-day" id="live-${k}"><div class="date" style="width:auto; text-align:left;"><b style="font-size:12.5px;">${CITIES[k].label}</b></div><div class="mid"><div class="out">讀取中...</div></div></div>`).join('');
  Object.keys(CITIES).forEach(k=>{
    if(cache[k] && cache[k].data){
      liveWeatherCache[k] = { data: cache[k].data, error:null, stale:true, fetchedAt: cache[k].fetchedAt };
      renderOneLiveCity(k);
    }
  });
  const timeEl = document.getElementById('liveWeatherTime');
  if(timeEl && hasAny){
    const times = Object.keys(CITIES).map(k=>cache[k] && cache[k].fetchedAt).filter(Boolean);
    const latest = times.length ? new Date(Math.max(...times)).toLocaleString('zh-TW', {hour12:false}) : '—';
    timeEl.textContent = navigator.onLine
      ? `顯示上次快取資料（更新於 ${latest}），正在取得最新資訊...`
      : `⚠️ 目前離線，顯示上次快取資料（更新於 ${latest}）`;
  }
  return hasAny;
}

async function loadLiveWeather(){
  const wrap = document.getElementById('liveWeatherList');
  if(!wrap) return;
  const timeEl = document.getElementById('liveWeatherTime');

  if(!navigator.onLine){
    const hasAny = renderWeatherFromCache();
    if(!hasAny && timeEl) timeEl.textContent = '⚠️ 目前離線，且尚無快取資料可顯示，請連上網路後再試一次。';
    return;
  }

  wrap.innerHTML = Object.keys(CITIES).map(k=>`<div class="weather-day" id="live-${k}"><div class="date" style="width:auto; text-align:left;"><b style="font-size:12.5px;">${CITIES[k].label}</b></div><div class="mid"><div class="out">讀取中...</div></div></div>`).join('');
  if(timeEl) timeEl.textContent = '即時資料抓取中...';

  await Promise.all(Object.keys(CITIES).map(k=>fetchWeatherFor(k, 0)));

  const failCount = Object.values(liveWeatherCache).filter(v=>v && v.error).length;
  const staleCount = Object.values(liveWeatherCache).filter(v=>v && v.stale).length;
  if(timeEl){
    if(staleCount && staleCount === Object.keys(CITIES).length){
      const times = Object.values(liveWeatherCache).map(v=>v.fetchedAt).filter(Boolean);
      timeEl.textContent = `⚠️ 目前離線，顯示快取資料（更新於 ${times.length?new Date(Math.max(...times)).toLocaleString('zh-TW',{hour12:false}):'—'}）`;
    } else if(failCount){
      timeEl.textContent = `即時資料更新於：${new Date().toLocaleString('zh-TW', {hour12:false})}（${failCount} 個地點連線失敗，可點擊下方「重新整理」再試一次）`;
    } else {
      timeEl.textContent = '即時資料更新於：' + new Date().toLocaleString('zh-TW', {hour12:false});
    }
  }
}

function renderOneLiveCity(k){
  const el = document.getElementById('live-'+k);
  if(!el) return;
  const entry = liveWeatherCache[k];
  const data = entry && entry.data;
  if(!data || !data.current){
    const reason = (entry && entry.error) ? entry.error : '暫時無法取得氣象資料';
    el.innerHTML = `<div class="mid" style="display:flex; align-items:center; justify-content:space-between; width:100%;"><div class="out">${CITIES[k].label}：${reason}</div><button onclick="fetchWeatherFor('${k}', 0)" style="background:#f2f3ec; border:none; color:var(--ink-soft); padding:4px 10px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer;">🔄 重試</button></div>`;
    return;
  }
  
  const cw = data.current;
  const [ico, desc] = wmoInfo(cw.weather_code);
  const temp = Math.round(cw.temperature_2m);
  const wind = cw.wind_speed_10m;
  const precip = cw.precipitation;
  const sr = data.daily && data.daily.sunrise ? data.daily.sunrise[0].substring(11, 16) : '--:--';
  const ss = data.daily && data.daily.sunset ? data.daily.sunset[0].substring(11, 16) : '--:--';
  const uv = data.daily && data.daily.uv_index_max ? getUVStars(data.daily.uv_index_max[0]) : '未知';
  const tip = getDynamicTip(temp, cw.weather_code);
  const badgeHtml = entry.stale
    ? `<span class="live-badge stale"><span class="dot"></span>快取${entry.fetchedAt ? '・' + new Date(entry.fetchedAt).toLocaleString('zh-TW',{hour12:false, month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'}) : ''}</span>`
    : `<span class="live-badge"><span class="dot"></span>即時</span>`;
  
  const MW_TIMES = { 'Wanaka':'20:00~', 'Tekapo':'19:45~', 'MtCook':'20:00~', 'Oamaru':'--', 'Dunedin':'--', 'TeAnau':'20:30~', 'Queenstown':'20:15~' };
  
  el.innerHTML = `
    <div style="display:flex; flex-direction:column; width:100%;">
      <div style="display:flex; align-items:center; gap:12px; width:100%; border-bottom:1px dashed #eee; padding-bottom:10px; margin-bottom:10px;">
        <div class="date" style="width:auto; text-align:left;"><b style="font-size:12.5px;">${CITIES[k].label}</b>${badgeHtml}</div>
        <div class="ico">${ico}</div>
        <div class="mid"><div class="place" style="font-size:14px; font-weight:900; white-space:nowrap;">${desc}</div><div class="out" style="font-size:11px; font-weight:700;">${temp}°C</div></div>
        <div class="w-bot" style="text-align:right;">
          <span style="display:block; font-size:10px;">風速 ${wind} km/h</span>
          <span style="display:block; font-size:10px; color:#c1502f;">降雨 ${precip} mm</span>
          <span style="display:block; font-size:10px; color:var(--teal);">UV ${uv}</span>
        </div>
      </div>
      <div class="astro-box" style="margin-top:0;">
        <span>🌅 日出 ${sr}</span>
        <span>🌇 日落 ${ss}</span>
        <span class="mw">🌌 銀河 ${MW_TIMES[k]}</span>
      </div>
      <div class="live-tip-box"><b>🧥 穿搭與裝備建議：</b><br>${tip}</div>
    </div>
  `;
}

/* ============ GUIDE LISTS ============ */
/* 這四份清單（打包／購物／規範／票券）過去只存在記憶體中，
   重新整理頁面就會整個消失、勾選與照片也不會保留。
   現在改為讀取與寫入 LocalStorage，行為和景點筆記／照片一致。 */
const defaultPackData = {
  '🎒 隨身背包':[{name:'護照＋機票／訂房憑證', qty:1, checked:false},{name:'國際駕照＋台灣駕照', qty:1, checked:false},{name:'行動電源＋備用電池', qty:2, checked:false},{name:'太陽眼鏡＋防曬乳', qty:1, checked:false},{name:'常備藥品', qty:1, checked:false}],
  '👜 手提行李':[{name:'Sony A7C2 相機', qty:1, checked:false},{name:'大光圈風景鏡頭／變焦鏡', qty:2, checked:false},{name:'大容量記憶卡', qty:2, checked:false},{name:'機上保暖薄毯/外套', qty:1, checked:false}],
  '🧳 託運行李':[{name:'Gore-Tex 防風防水外套', qty:1, checked:false},{name:'刷毛／羽絨保暖中層', qty:2, checked:false},{name:'防潑水保暖登山長褲', qty:3, checked:false},{name:'抓地力登山鞋（需清潔）', qty:1, checked:false},{name:'保暖毛帽＋厚手套＋圍巾', qty:1, checked:false}]
};
let packData = JSON.parse(localStorage.getItem('nz_pack')) || defaultPackData;
function persistPack(){ safeSetItem('nz_pack', packData); }

const defaultShopData = [{name:'Manuka 麥蘆卡蜂蜜', qty:1, checked:false, imgs:[], cat:'supermarket', location:''},{name:'美麗諾羊毛製品', qty:1, checked:false, imgs:[], cat:'souvenir', location:''},{name:'Whittaker\'s 巧克力', qty:1, checked:false, imgs:[], cat:'supermarket', location:''}];
let shopData = JSON.parse(localStorage.getItem('nz_shop')) || defaultShopData;
/* 相容舊資料：舊版每個項目只有單一 img 欄位，改版後改為 imgs 陣列（可放多張照片，例如想比較不同牌子的優格）*/
shopData.forEach(it=>{ if(!it.imgs){ it.imgs = it.img ? [it.img] : []; } });
function persistShop(){ safeSetItem('nz_shop', shopData); }
const SHOP_CATS = {supermarket:{label:'🛒 超市', color:'#2f8a52'}, souvenir:{label:'🎁 紀念品', color:'#c1502f'}};

function renderPackList(){
  const wrap = document.getElementById('packListWrap');
  if(!wrap) return;
  wrap.innerHTML = Object.keys(packData).map(cat=>`<div class="pack-cat"><div class="cat-title">🔹 ${cat}</div>${packData[cat].map((it,i)=>`<div class="pack-item ${it.checked?'checked':''}"><input type="checkbox" ${it.checked?'checked':''} onchange="togglePack('${cat}',${i})"><div class="name">${it.name}</div><div class="qty"><button onclick="changeQty('${cat}',${i},-1)">－</button><span>${it.qty}</span><button onclick="changeQty('${cat}',${i},1)">＋</button></div><button class="del" onclick="delPack('${cat}',${i})">✕</button></div>`).join('')}</div>`).join('') + `<div class="add-row"><select id="packCatSelect" style="border:1.5px solid var(--line); border-radius:999px; padding:9px 10px; font-size:12px; font-family:inherit;">${Object.keys(packData).map(c=>`<option value="${c}">${c}</option>`).join('')}</select><input type="text" id="newPackItem" placeholder="新增項目..."><button onclick="addPackItem()">＋</button></div>`;
}
function togglePack(cat,i){ packData[cat][i].checked = !packData[cat][i].checked; persistPack(); renderPackList(); }
function changeQty(cat,i,delta){ packData[cat][i].qty = Math.max(1, packData[cat][i].qty+delta); persistPack(); renderPackList(); }
function delPack(cat,i){ packData[cat].splice(i,1); persistPack(); renderPackList(); }
function addPackItem(){ const cat = document.getElementById('packCatSelect').value; const input = document.getElementById('newPackItem'); if(input && input.value.trim()){ packData[cat].push({name:input.value.trim(), qty:1, checked:false}); persistPack(); renderPackList(); } }

function renderShopList(){
  const wrap = document.getElementById('shopListWrap');
  if(!wrap) return;
  wrap.innerHTML = Object.keys(SHOP_CATS).map(catKey=>{
    const catInfo = SHOP_CATS[catKey];
    const rows = shopData.map((it,i)=>({it,i})).filter(({it})=>(it.cat||'supermarket')===catKey);
    const itemsHTML = rows.map(({it,i})=>{
      const imgs = it.imgs || [];
      const thumbsHTML = imgs.map((img,ii)=>`<div style="position:relative; display:inline-block;"><img src="${img}" style="width:36px; height:36px; object-fit:cover; border-radius:6px; margin-right:4px;" onclick="openAttachModal('${img}')"><button onclick="removeShopImg(${i},${ii})" style="position:absolute; top:-4px; right:-2px; background:rgba(0,0,0,0.5); color:#fff; border:none; border-radius:50%; width:16px; height:16px; font-size:8px; cursor:pointer;">✕</button></div>`).join('');
      return `<div class="pack-item ${it.checked?'checked':''}" style="flex-wrap:wrap; align-items:center;"><input type="checkbox" ${it.checked?'checked':''} onchange="toggleShop(${i})">${thumbsHTML}<div class="name">${it.name}</div><div class="qty"><button onclick="document.getElementById('shopFile-${i}').click()" style="background:transparent; font-size:14px; margin-right:4px; border:none; cursor:pointer;">📷</button><button onclick="changeShopQty(${i},-1)">－</button><span>${it.qty}</span><button onclick="changeShopQty(${i},1)">＋</button></div><button class="del" onclick="delShop(${i})">✕</button><input type="file" id="shopFile-${i}" accept="image/*" multiple style="display:none" onchange="handleShopPhoto(event, ${i})"><div style="flex-basis:100%; display:flex; gap:6px; align-items:center; margin-top:6px; padding-left:28px;"><input type="text" value="${(it.location||'').replace(/"/g,'&quot;')}" placeholder="建議購買位置或其他資訊..." onchange="setShopLocation(${i}, this.value)" style="flex:1; border:1.5px solid var(--line); border-radius:999px; padding:4px 10px; font-size:11px; font-family:inherit; min-width:120px;"></div></div>`;
    }).join('');
    return `<div class="pack-cat" style="margin-bottom:16px;"><div class="cat-title" style="color:${catInfo.color};">${catInfo.label}購買清單</div>${itemsHTML || `<div class="source-note" style="margin-bottom:8px;">尚無項目</div>`}<div class="add-row"><input type="text" id="newShopItem-${catKey}" placeholder="新增項目..."><button onclick="addShopItem('${catKey}')">＋</button></div></div>`;
  }).join('');
}
function handleShopPhoto(e, i){
  const files = Array.from(e.target.files || []);
  if(files.length){
    if(!shopData[i].imgs) shopData[i].imgs = [];
    Promise.all(files.map(fileToDataURL)).then(dataUrls=>{ shopData[i].imgs.push(...dataUrls); persistShop(); renderShopList(); });
  }
  e.target.value='';
}
function removeShopImg(i, imgIdx){ shopData[i].imgs.splice(imgIdx,1); persistShop(); renderShopList(); }
function toggleShop(i){ shopData[i].checked = !shopData[i].checked; persistShop(); renderShopList(); }
function changeShopQty(i,delta){ shopData[i].qty = Math.max(1, shopData[i].qty+delta); persistShop(); renderShopList(); }
function delShop(i){ shopData.splice(i,1); persistShop(); renderShopList(); }
function addShopItem(catKey){ const input = document.getElementById('newShopItem-'+catKey); if(input && input.value.trim()){ shopData.push({name:input.value.trim(), qty:1, checked:false, imgs:[], cat:catKey, location:''}); persistShop(); renderShopList(); } }
function setShopLocation(i, val){ shopData[i].location = val; persistShop(); }

/* ============ CUSTOM TRAVEL RULES ============ */
const defaultRulesData = [
  { title: '生物安全申報', desc: '入境卡需誠實申報戶外裝備、登山鞋，鞋底務必清潔。', img: null },
  { title: '靠左行駛', desc: '右駕靠左通行，山路多彎、單線橋需禮讓標誌方向。', img: null },
  { title: '國際駕照', desc: '需攜帶台灣駕照＋國際駕照（IDP）。', img: null }
];
let rulesData = JSON.parse(localStorage.getItem('nz_rules')) || defaultRulesData;
/* 相容舊資料：舊版是單一 text 欄位（標題用 <b> 包在文字前面），改版後拆成 title／desc 兩個獨立欄位 */
rulesData.forEach(r=>{
  if(r.text !== undefined && r.title === undefined){
    const m = /^<b>(.*?)<\/b>[：:]?\s*(.*)$/s.exec(r.text || '');
    if(m){ r.title = m[1]; r.desc = m[2]; } else { r.title = ''; r.desc = r.text || ''; }
    delete r.text;
  }
});
function persistRules(){ safeSetItem('nz_rules', rulesData); }

function renderRulesList() {
  const wrap = document.getElementById('rulesListWrap');
  if(!wrap) return;
  wrap.innerHTML = rulesData.map((r, i) => `
    <div class="rule-item" style="align-items:flex-start; background:#f9f9f9; padding:10px; border-radius:8px; border:1px solid #eee;">
      <span class="dot" style="margin-top:2px;">●</span>
      <div style="flex:1;">
        ${r.title ? `<div style="font-weight:900; font-size:13px; margin-bottom:3px; color:var(--ink);">${r.title}</div>` : ''}
        <span>${r.desc}</span>
        <div style="margin-top:8px; display:flex; gap:8px;">
          ${r.img ? `<button onclick="openAttachModal('${r.img}')" style="background:var(--teal); color:#fff; border:none; padding:6px 12px; border-radius:6px; font-size:11.5px; font-weight:700; cursor:pointer; box-shadow:var(--shadow-sm);">🖼️ 檢視附圖</button>
                     <button onclick="removeRuleImg(${i})" style="background:#f2f3ec; color:var(--ink); border:none; padding:6px 12px; border-radius:6px; font-size:11.5px; font-weight:700; cursor:pointer;">✕ 移除</button>` 
                  : `<button onclick="document.getElementById('ruleFile-${i}').click()" style="background:#fff; border:1px dashed #ccc; color:var(--ink-soft); padding:6px 12px; border-radius:6px; font-size:11.5px; font-weight:700; cursor:pointer;">📷 新增附圖</button>`}
          <input type="file" id="ruleFile-${i}" accept="image/*" style="display:none" onchange="handleRulePhoto(event, ${i})">
        </div>
      </div>
      <button class="del" onclick="delRule(${i})" style="margin-top:2px;">✕</button>
    </div>
  `).join('') + `
    <div class="add-row" style="margin-bottom:6px;">
      <input type="text" id="newRuleTitle" placeholder="標題（例如：行李限重）...">
    </div>
    <div class="add-row">
      <input type="text" id="newRuleItem" placeholder="內文說明...">
      <button onclick="addRuleItem()">＋</button>
    </div>
  `;
}
function handleRulePhoto(e, i) { const f = e.target.files[0]; if(f){ fileToDataURL(f).then(dataUrl=>{ rulesData[i].img = dataUrl; persistRules(); renderRulesList(); }); } e.target.value=''; }
function removeRuleImg(i) { rulesData[i].img = null; persistRules(); renderRulesList(); }
function delRule(i) { rulesData.splice(i, 1); persistRules(); renderRulesList(); }
function addRuleItem() {
  const titleInput = document.getElementById('newRuleTitle');
  const input = document.getElementById('newRuleItem');
  if(input && input.value.trim()){
    rulesData.push({title: (titleInput && titleInput.value.trim()) || '', desc: input.value.trim(), img: null});
    persistRules(); renderRulesList();
  }
}

/* ============ DYNAMIC DOCS/VOUCHERS ============ */
const defaultDocsData = [
  { ic: '✈️', t: '去程國際線 CI53', s: '9/11(五) 23:55 TPE → 9/12(六) 約18:25 AKL', chip: '已確認', link: '', img: null },
  { ic: '✈️', t: '南島國內線 NZ617', s: '9/13 10:25 AKL → 12:20 ZQN', chip: '已確認', link: '', img: null },
  { ic: '✈️', t: '南島國內線 NZ630', s: '9/27 14:15 ZQN → 16:05 AKL', chip: '已確認', link: '', img: null },
  { ic: '✈️', t: '回程國際線 CI54', s: '9/27 AKL 出發 → 9/28(一) 抵達 TPE', chip: '已確認', link: '', img: null },
  { ic: '🏨', t: 'Wanaka Lake View', s: '9/13–9/15・2晚・Airbnb', chip: '已確認', link: 'https://www.airbnb.com.tw/rooms/835936560022815796', img: null },
  { ic: '🏨', t: 'Starview 88 - Tekapo', s: '9/15–9/17・2晚・Agoda', chip: '已確認', link: 'https://www.agoda.com/zh-tw/starview-88/hotel/lake-tekapo-nz.html', img: null },
  { ic: '🏨', t: 'Mt Cook Motels', s: '9/17–9/19・2晚・官網辦理', chip: '已確認', link: 'https://www.hermitage.co.nz/stay/mt-cook-motels/', img: null },
  { ic: '🏨', t: 'Lune Lux（Oamaru）', s: '9/19–9/20・1晚・Booking.com', chip: '已確認', link: 'https://www.booking.com/hotel/nz/lune-lux.html', img: null },
  { ic: '🏨', t: 'Bluestone On George', s: '9/20–9/22・2晚・官網辦理', chip: '已確認', link: 'https://www.bluestonedunedin.co.nz/', img: null },
  { ic: '🏨', t: 'Black\'s Hut', s: '9/22–9/24・2晚・Airbnb', chip: '已確認', link: 'https://www.airbnb.com/rooms/52614454', img: null },
  { ic: '🏨', t: 'Goldrush Escape', s: '9/24–9/27・3晚・Airbnb', chip: '已確認', link: 'https://www.airbnb.com.tw/rooms/16826185', img: null },
  { ic: '🚗', t: '自駕租車憑證', s: 'ZQN 機場取還車', chip: '待上傳', link: '', img: null }
];
let docsData = JSON.parse(localStorage.getItem('nz_docs')) || defaultDocsData;
function persistDocs(){ safeSetItem('nz_docs', docsData); }

function renderDocsList() {
  const wrap = document.getElementById('docsListWrap');
  if(!wrap) return;
  wrap.innerHTML = docsData.map((d, i) => `
    <div class="doc-item">
      <div class="l" style="flex:1; cursor:pointer;" onclick="handleDocClick(${i})">
        <div class="ic">${d.ic}</div>
        <div>
          <div class="t" style="${d.link && !d.img ? 'color:var(--blue); text-decoration:underline;' : ''}">${d.t}</div>
          <div class="s">${d.s}</div>
        </div>
      </div>
      <div style="display:flex; flex-direction:column; gap:6px; align-items:flex-end;">
        <div class="chip" style="${d.img ? 'background:var(--blue); color:#fff;' : ''}">${d.img ? '憑證就緒' : d.chip}</div>
        ${d.img ? `<button onclick="openAttachModal('${d.img}')" style="background:var(--blue); color:#fff; border:none; padding:6px 10px; border-radius:6px; font-size:11px; font-weight:900; cursor:pointer; white-space:nowrap; box-shadow:var(--shadow-sm);">📱 出示截圖</button>
                   <button onclick="removeDocImg(${i})" style="background:transparent; color:#c1502f; border:none; padding:0; font-size:10px; font-weight:700; cursor:pointer; text-decoration:underline;">✕ 移除</button>`
                : `<button onclick="document.getElementById('docFile-${i}').click()" style="background:#fff; border:1px dashed #ccc; color:var(--ink-soft); padding:5px 10px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; white-space:nowrap;">📎 上傳截圖</button>`}
        <input type="file" id="docFile-${i}" accept="image/*" style="display:none" onchange="handleDocPhoto(event, ${i})">
      </div>
    </div>
  `).join('');
}
function handleDocClick(i) { const d = docsData[i]; if(d.img) openAttachModal(d.img); else if(d.link) window.open(d.link, '_blank'); }
function handleDocPhoto(e, i) { const f = e.target.files[0]; if(f){ fileToDataURL(f).then(dataUrl=>{ docsData[i].img = dataUrl; persistDocs(); renderDocsList(); }); } e.target.value=''; }
function removeDocImg(i) { docsData[i].img = null; persistDocs(); renderDocsList(); }

/* ============ 跨裝置備份／還原（匯出/匯入 JSON 檔） ============ */
/* 這個網頁是純前端靜態檔案，沒有伺服器，資料只存在「這台裝置的這個瀏覽器」裡（localStorage），
   所以電腦上輸入的東西手機打開同一個網址是看不到的——並非程式錯誤，而是本來就沒有雲端資料庫可以互通。
   這裡提供匯出/匯入功能，讓使用者可以手動把資料在裝置之間搬移，達到「同步」的效果。 */
function exportBackup(){
  const data = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.indexOf('nz_') === 0) data[k] = localStorage.getItem(k);
  }
  const blob = new Blob([JSON.stringify(data)], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  a.href = url;
  a.download = `南島行程備份_${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function importBackupFile(e){
  const f = e.target.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const keys = Object.keys(data).filter(k => k.indexOf('nz_') === 0);
      if (!keys.length) { alert('⚠️ 這個檔案看起來不是本行程的備份檔，請確認選擇了正確的 .json 檔案。'); return; }
      if (!confirm(`即將把備份檔中的 ${keys.length} 項資料匯入到這台裝置，並覆蓋這台裝置上同名的筆記／照片／清單資料。確定要繼續嗎？`)) return;
      let failCount = 0;
      keys.forEach(k => {
        try { localStorage.setItem(k, data[k]); } catch(err) { failCount++; console.error('匯入失敗：', k, err); }
      });
      if (failCount > 0) alert(`⚠️ 有 ${failCount} 項資料因裝置儲存空間不足而匯入失敗，其餘資料已匯入成功。`);
      else alert('✅ 匯入完成！頁面即將重新整理套用新資料。');
      location.reload();
    } catch(err) {
      alert('⚠️ 讀取備份檔失敗，請確認選擇的是先前用「匯出備份」產生的 .json 檔。');
    }
  };
  reader.readAsText(f);
  e.target.value = '';
}

/* ============ 線上／離線狀態 ============ */
function updateNetStatus(){
  const el = document.getElementById('netStatus');
  if(!el) return;
  const online = navigator.onLine;
  el.classList.toggle('online', online);
  el.classList.toggle('offline', !online);
  el.innerHTML = online
    ? '<span class="net-dot online"></span><span class="net-txt">線上</span>'
    : '<span class="net-dot offline"></span><span class="net-txt">離線</span>';
}
window.addEventListener('online', ()=>{ updateNetStatus(); loadLiveWeather(); });
window.addEventListener('offline', updateNetStatus);

/* ============ Service Worker（離線快取整個網頁） ============ */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(function(){ /* 若以 file:// 開啟或不支援，靜默略過 */ });
  });
}

/* ============ TABS ============ */
function setTab(tab) {
  document.querySelectorAll('.tab-btn, .nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll(`[onclick="setTab('${tab}')"]`).forEach(b => b.classList.add('active'));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-'+tab).classList.add('active');
  window.scrollTo({top:0, behavior:'smooth'});
  if(tab === 'weather' && rainRadarMap){ setTimeout(()=>rainRadarMap.invalidateSize(), 100); }
}

/* ============ INIT ============ */
updateSpotCount();
renderDayChips();
renderDayContent();
renderPackList();
renderShopList();

/* ===== 頁面就緒後的初始化呼叫 (原第二段 inline script) ===== */
renderRulesList();
renderDocsList();
updateNetStatus();
renderWeatherFromCache();
loadLiveWeather();
initRainRadar();
