import * as echarts from 'echarts/core';
import { ScatterChart, LineChart, BarChart, TreemapChart, CustomChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, DataZoomComponent, LegendComponent, MarkLineComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { LabelLayout } from 'echarts/features';
import { createIcons, ArrowRight, ArrowUpRight, Blocks, CalendarDays, ChartBar, ChartLine, ChartNoAxesCombined, ChartPie, ChartScatter, ChevronRight, CircleAlert, Crosshair, Database, Download, FileSpreadsheet, Gamepad2, Image, Info, Link, ListFilter, Menu, MessagesSquare, MousePointer2, Orbit, Plus, RotateCcw, ScanSearch, ScatterChart as ScatterIcon, Search, SearchX, SlidersHorizontal, Sparkles, Table2, Tags, Type, Waypoints, X, Youtube } from 'lucide';
import './style.css';
import { setLanguage, translate as t, localize, translateHTML } from './i18n';

let language=localStorage.getItem('steam-atlas-language')||'zh';
let theme=localStorage.getItem('steam-atlas-theme')||'light';
setLanguage(language);
document.documentElement.dataset.theme=theme;
const gameName=(g:Row)=>language==='zh'?(g.name_zh||g.name):g.name;
echarts.use([ScatterChart, LineChart, BarChart, TreemapChart, CustomChart, GridComponent, TooltipComponent, DataZoomComponent, LegendComponent, MarkLineComponent, CanvasRenderer, LabelLayout]);
const icons = { ArrowRight, ArrowUpRight, Blocks, CalendarDays, ChartBar, ChartLine, ChartNoAxesCombined, ChartPie, ChartScatter, ChevronRight, CircleAlert, Crosshair, Database, Download, FileSpreadsheet, Gamepad2, Image, Info, Link, ListFilter, Menu, MessagesSquare, MousePointer2, Orbit, Plus, RotateCcw, ScanSearch, ScatterChart: ScatterIcon, Search, SearchX, SlidersHorizontal, Sparkles, Table2, Tags, Type, Waypoints, X, Youtube };

type Row = Record<string, any>;
type Family = { color: string; tags: string[] };
type Meta = { total: number; tags: number; taxonomy: Record<string, Family>; tagCounts: Record<string, number>; lastUpdatedAt?:string; lastCompletedAt?:string; today:string };
type ChartData = { kind: string; rows: Row[]; series: Row[]; matched: number; stats: Row; insights: Row[]; elapsedMs: number; totalRanked?: number };
type Preset = { id: string; label: string; mode: string; section: string; source: string; params?: Record<string,string> };
const presets: Preset[] = [
  {id:'releases', label:'Game releases over time', mode:'releases', section:'THE CATALOG', source:'20221119'},
  {id:'words', label:'Most common words', mode:'words', section:'THE CATALOG', source:'20054087'},
  {id:'positive', label:'Overwhelmingly positive', mode:'ratings', section:'THE CATALOG', source:'20221305',params:{rating:'Overwhelmingly Positive'}},
  {id:'negative', label:'Overwhelmingly negative', mode:'ratings', section:'THE CATALOG', source:'20221377',params:{rating:'Overwhelmingly Negative'}},
  {id:'genre-genre',label:'Genre × Genre',mode:'pairs',section:'TAG RELATIONSHIPS',source:'20059232',params:{left:'Genres',right:'Genres'}},
  {id:'themes',label:'Top themes',mode:'themes',section:'TAG RELATIONSHIPS',source:'20221430'},
  {id:'genre-theme',label:'Genre × Theme',mode:'pairs',section:'TAG RELATIONSHIPS',source:'20073344',params:{left:'Genres',right:'Themes'}},
  {id:'genre-dimension',label:'Genre × Dimension',mode:'pairs',section:'TAG RELATIONSHIPS',source:'20074409',params:{left:'Genres',right:'Dimensions'}},
  {id:'genre-perspective',label:'Genre × Perspective',mode:'pairs',section:'TAG RELATIONSHIPS',source:'20074514',params:{left:'Genres',right:'Viewpoints'}},
  {id:'dimensions',label:'Dimensions over time',mode:'dimensions',section:'CHANGING TRENDS',source:'20221523'},
  {id:'female',label:'Female protagonist',mode:'representation',section:'CHANGING TRENDS',source:'20255396',params:{tag:'Female Protagonist'}},
  {id:'lgbtq',label:'LGBTQ+',mode:'representation',section:'CHANGING TRENDS',source:'20255422',params:{tag:'LGBTQ+'}},
  {id:'deck-releases',label:'Releases',mode:'deck_releases',section:'ROGUELIKE DECKBUILDERS',source:'20238203'},
  {id:'deck-reviews',label:'Reviews',mode:'deck_reviews',section:'ROGUELIKE DECKBUILDERS',source:'20238521'},
  {id:'deck-best',label:'Best games',mode:'deck_best',section:'ROGUELIKE DECKBUILDERS',source:'20238736'},
];
const originalGenres=['Action RPG','Action-Adventure','Arcade','Auto Battler','Automobile Sim','Base Building','Battle Royale','Board Game','Building','Card Game','Clicker','Cooking','Exploration','Farming Sim','Fighting','Hidden Object','Idler','Interactive Fiction','MMORPG','Management','Match 3','Open World','Party-Based RPG','Platformer','Point & Click','RTS','Rhythm','Roguelike','Sandbox','Shooter','Space Sim','Stealth','Strategy RPG','Survival','Tower Defense','Turn-Based Strategy','Visual Novel','Walking Simulator','Word Game','eSports'].join('|');
const originalThemes=["1990's",'Dark Fantasy','Family Friendly','Fantasy','Futuristic','Hentai','Historical','LGBTQ+','Logic','Magic','Medieval','Mystery','Post-apocalyptic','Retro','Romance','Sci-fi','Space','Tactical','War','Zombies'].join('|');
const originalPerspectives=['First-Person','Isometric','Text-Based','Third Person','Top-Down'].join('|');
const defaults: Record<string,string> = {view:'genre-dimension',start:'1997-01-01',end:'2024-10-31',minReviews:'0',type:'game',price:'all',undated:'false',include:'',exclude:'',left:'Genres',right:'Dimensions',aTags:originalGenres,bTags:'',minCommon:'1',period:'year',limit:'30',rank:'reviews',group:'Themes',share:'false',xMetric:'x',yMetric:'y',xLog:'true',yLog:'true',layout:'treemap',dim25:'false',references:'true',deckScope:'broad',bestMinReviews:'1000'};
defaults.end=new Date().toLocaleDateString('en-CA');
let state = {...defaults,...Object.fromEntries(new URLSearchParams(location.search))};
let meta: Meta;
let data: ChartData | null = null;
let selected: Row | null = null;
let detailPair: {a:string;b:string} | null = null;
let detailOffset = 0;
let detailsVersion = 0;
let searchVersion = 0;
let controller: AbortController | null = null;
let lastDuration = 0;
let pickerTarget = '';
let chart: echarts.ECharts;
let resizeObserver: ResizeObserver;
const $ = <T extends HTMLElement = HTMLElement>(id:string) => document.getElementById(id) as T;
const esc = (s:unknown) => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const number = (n:number) => new Intl.NumberFormat('en-US').format(n);
const compact = (n:number) => new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(n);
const icon = (name:string) => `<i data-lucide="${name}"></i>`;
const refreshIcons = () => {createIcons({icons,attrs:{'stroke-width':1.7}});localize($('app'));};
const preset = () => presets.find(p=>p.id===state.view) || presets[7];
const groups = () => Object.keys(meta.taxonomy);
const selectOptions = (values:string[],value:string) => values.map(v=>`<option ${v===value?'selected':''} value="${esc(v)}">${esc(v)}</option>`).join('');
const updateURL = () => history.replaceState(null,'',`${location.pathname}?${new URLSearchParams(Object.entries(state).filter(([k,v])=>v!==defaults[k]))}`);
const notify = (message:string) => { $('toast').textContent=message; $('toast').classList.add('show'); setTimeout(()=>$('toast').classList.remove('show'),3500); };

async function api(path:string,params:Record<string,string>={},signal?:AbortSignal) {
  const response=await fetch(`/api/${path}?${new URLSearchParams(params)}`,{signal});
  if(!response.ok) throw new Error((await response.json()).error || 'The catalog could not be loaded.');
  return response.json();
}
function navHTML() {
  let section='';
  return presets.map(p=>{
    const heading=p.section!==section?`<div class="nav-section">${p.section}</div>`:'';section=p.section;
    const symbol=p.mode==='pairs'?'scatter-chart':p.mode.includes('releases')?'chart-no-axes-combined':p.mode==='words'?'type':p.mode==='themes'?'blocks':p.mode.includes('reviews')?'chart-scatter':p.mode.includes('best')||p.mode==='ratings'?'chart-bar':'chart-line';
    return `${heading}<button class="nav-item ${p.id===state.view?'active':''}" data-view="${p.id}">${icon(symbol)}<span>${p.label}</span>${p.id===state.view?'<span class="nav-dot"></span>':''}</button>`;
  }).join('');
}
function shell() {
  $('app').innerHTML=`<aside id="sidebar"><a class="brand" href="/">${icon('orbit')}<span>steam<span class="brand-light">atlas</span><small>THE CATALOG, CONNECTED.</small></span></a><nav id="nav">${navHTML()}</nav><div class="sidebar-bottom"><button id="taxonomy-open">${icon('tags')}<span>Explore all tag families</span>${icon('arrow-up-right')}</button><a href="https://github.com/NewbieIndieGameDev/steam-insights" target="_blank" rel="noopener">${icon('database')}<span>Original dataset<small>Newbie Indie Game Dev</small></span>${icon('arrow-up-right')}</a></div></aside>
  <main><header class="topbar"><div class="breadcrumb"><button id="mobile-menu" aria-label="Toggle navigation">${icon('menu')}</button><span>Workspace</span>${icon('chevron-right')}<strong>Catalog explorer</strong></div><div class="top-actions"><span class="snapshot"><span></span>OCT 2024 SNAPSHOT</span><button class="quiet" id="about-open" aria-label="About the data">${icon('info')}</button><a class="quiet" href="https://www.youtube.com/watch?v=qiNv3qv-YbU" target="_blank" rel="noopener" aria-label="Watch the original video">${icon('youtube')}</a></div></header>
  <div class="workspace"><section class="intro"><div><div class="eyebrow" id="eyebrow">TAG RELATIONSHIPS <span> / </span> PAIRS EXPLORER</div><h1 id="hero-title">Every combination.<br><span>A different story.</span></h1><p id="hero-description">Explore how Steam tags intersect. Find connections hiding in the catalog.</p></div><div class="intro-note"><span class="mini-orbit">✳</span><p>A whole catalog.<br>Endless ways to look at it.</p><small>${number(meta.total)} records · ${meta.tags} tags</small></div></section>
  <section class="stats" id="stats"><div class="stat"><span>GAMES IN SELECTION</span><strong>—</strong></div><div class="stat"><span>TAG COMBINATIONS</span><strong>—</strong></div><div class="stat"><span>TOTAL REVIEWS</span><strong>—</strong></div><div class="stat"><span>REVIEW COVERAGE</span><strong>—</strong></div></section>
  <section class="explorer"><div class="explorer-top"><div class="explorer-tabs"><span class="current-tab">${icon('chart-scatter')}<b id="view-label">Pairs explorer</b></span><button id="data-tab">${icon('table-2')}Data table</button></div><div class="explorer-actions"><button id="filters-open">${icon('sliders-horizontal')}Filters <span id="filter-count" class="count">0</span></button><button id="export-open">${icon('download')}Export</button><button class="square" id="share-link" aria-label="Copy view link">${icon('link')}</button></div></div>
  <div class="config" id="config"></div><div class="chart-heading"><div><div class="chart-kicker" id="chart-kicker">TAG COMBINATIONS</div><h2 id="chart-title">Genre × Dimension</h2></div><div class="search-container"><div class="search-box">${icon('search')}<input id="game-search" placeholder="Find a game to highlight…" autocomplete="off" aria-label="Find a game to highlight"><kbd>/</kbd></div><div id="search-results" class="search-results" hidden></div></div></div>
  <div id="highlight" hidden></div><div class="chart-options" id="chart-options"></div><div class="chart-stage"><div id="chart" role="img" aria-label="Interactive Steam catalog chart"></div><div id="chart-message" hidden></div><div id="loading" class="loading"><span class="spinner"></span>Calculating from the catalog…</div></div><div class="chart-footer"><span id="chart-legend"><i></i>Each dot is a tag combination</span><span id="calculation">Live calculation</span></div><div id="data-table" hidden></div></section>
  <section class="insights-heading"><span>${icon('sparkles')}FROM THIS SELECTION</span><small>Patterns to explore, grounded in the data</small></section><section id="insights" class="insights"></section><footer class="page-footer"><span>Steam Catalog Insights · October 2024 baseline + incremental updates</span><a id="original-link" target="_blank" rel="noopener">View original chart ${icon('arrow-up-right')}</a></footer></div></main>
  <div id="shade" hidden></div><aside id="filter-drawer" class="drawer" hidden><div class="drawer-heading"><div><span class="eyebrow">REFINE THE CATALOG</span><h2>Filters</h2></div><button data-close aria-label="Close filters">${icon('x')}</button></div><p class="muted">Changes recalculate every chart in this view.</p><label class="field">Release date range<div class="date-pair"><input type="date" data-state="start" value="${state.start}"><span>–</span><input type="date" data-state="end" value="${state.end}"></div></label><label class="field">Minimum reviews<input type="number" min="0" data-state="minReviews" value="${state.minReviews}"></label><label class="field">Record type<select data-state="type"><option value="game">Games</option><option value="demo">Demos</option><option value="all">Games + demos</option></select></label><label class="field">Pricing<select data-state="price"><option value="all">All games</option><option value="free">Free</option><option value="paid">Not marked free</option></select></label><label class="check-field"><input type="checkbox" data-state="undated" ${state.undated==='true'?'checked':''}>Include undated / upcoming records</label><p class="field-help">Undated records can be counted in pairs and rankings, but cannot appear on a time axis.</p><div class="field">Must include all tags<button class="add-tag" data-picker="include">${icon('plus')}Add required tags</button><div id="include-chips" class="chips"></div></div><div class="field">Exclude any of these tags<button class="add-tag" data-picker="exclude">${icon('plus')}Add excluded tags</button><div id="exclude-chips" class="chips"></div></div><button class="reset-button" id="reset-filters">${icon('rotate-ccw')}Reset filters</button><div class="filter-note">Tags reflect each record’s collection time. Unreleased records have no invented dates or reviews.</div></aside>
  <dialog id="picker"><div class="dialog-heading"><div><span class="eyebrow">THE STEAM TAG TAXONOMY</span><h2 id="picker-title">Explore tag families</h2></div><button id="picker-close" aria-label="Close tag browser">${icon('x')}</button></div><p class="muted" id="picker-description"></p><div class="picker-tools"><div class="search-box">${icon('search')}<input id="tag-search" placeholder="Search 447 tags…" aria-label="Search tags"></div><button id="picker-clear">Clear selection</button><button id="picker-all">Select all visible</button></div><div id="taxonomy-grid"></div><div class="dialog-footer"><span id="picker-count"></span><button class="primary" id="picker-done">Apply selection ${icon('arrow-right')}</button></div></dialog>
  <dialog id="details"><div class="dialog-heading"><div><span class="eyebrow">BEHIND THE COMBINATION</span><h2 id="details-title"></h2></div><button id="details-close" aria-label="Close game details">${icon('x')}</button></div><p class="muted" id="details-count"></p><div id="details-content"></div><div class="dialog-footer"><button id="details-prev">← Previous</button><span id="details-page"></span><button id="details-next">Next →</button></div></dialog>
  <dialog id="about"><div class="dialog-heading"><h2>About this explorer</h2><button id="about-close" aria-label="Close about">${icon('x')}</button></div><p>All 15 original charts are available as presets. The original October 2024 snapshot is preserved. Sync progressively updates records from Steam, store tags and SteamSpy; chart selections query the current local database. The latest record update does not mean the whole catalog has been refreshed.</p><h3>How to read pairs</h3><p>Each point represents two tags. By default, X counts games with either tag (union), and Y counts games with both (intersection). Tag families choose the candidate tags, not the numeric axes. Jaccard = intersection / union. Lift compares observed overlap with overlap expected under independence.</p><h3>Tag families</h3><p>The 16 families follow the supplied reference image. Membership is reconstructed using Steamworks documentation and can be edited in <code>taxonomy.json</code>. Tags can appear in more than one family. Exact author tag assignments were not included in the dataset.</p><h3>Counting and coverage</h3><p>Games are deduplicated by Steam App ID. The default selection excludes demos and records without release dates, and ends today. A valid date does not prove that a game was released at collection time. Rankings use stored Steam rating labels. Time charts omit undated records and fill missing periods with zero. The current calendar year may be partial. Each game stores its own collection timestamp.</p><p>Small tag overlaps indicate frequency, not proven market demand. Cumulative reviews are not sales. Software can be included in the source's game record type. Prices are only filtered by the source's free flag; mixed currencies are not compared.</p><div class="source-links"><a href="https://github.com/NewbieIndieGameDev/steam-insights" target="_blank" rel="noopener">Original dataset ↗</a><a href="https://partner.steamgames.com/doc/store/tags?l=english" target="_blank" rel="noopener">Steamworks tag documentation ↗</a><a href="https://www.youtube.com/watch?v=qiNv3qv-YbU" target="_blank" rel="noopener">Original video ↗</a></div></dialog>
  <div id="export-menu" hidden><button data-export="png">${icon('image')}Download chart PNG</button><button data-export="csv">${icon('file-spreadsheet')}Download chart data CSV</button></div><div id="toast" role="status"></div>`;
  document.querySelector('.top-actions')!.insertAdjacentHTML('afterbegin',`<div class="preferences"><select id="theme-select" aria-label="Theme"><option value="light">Light</option><option value="dark">Dark</option></select><select id="language-select" aria-label="Language"><option value="zh">\u7b80\u4f53\u4e2d\u6587</option><option value="en">English</option></select></div><button id="sync-open">${icon('rotate-ccw')}Sync data</button>`);
  $('app').insertAdjacentHTML('beforeend',`<dialog id="sync-dialog"><div class="dialog-heading"><h2>Steam data sync</h2><button id="sync-close" aria-label="Close sync dialog">${icon('x')}</button></div><p>Collect details, all-language review totals, SteamSpy metrics, store tags and Chinese names. Progress is saved after every app. The first pass can take days; you can pause and resume.</p><div id="sync-content"></div><label class="field">Optional Steam API Key<input id="sync-key" class="sync-key" type="password" autocomplete="off" placeholder="Optional Steam API Key"></label><p>A key enables the complete Steam API catalog. Without a key, discover searchable game and demo releases since October 2024; coverage may exclude removed or region-hidden apps.</p><p>Chinese names come from Steam. Games without a localized title retain their English name.</p><div class="sync-actions"><button class="primary" id="sync-start">Start / resume sync</button><button id="sync-pause">Pause sync</button><button id="sync-refresh">Refresh charts</button></div></dialog>`);
  ($('theme-select') as HTMLSelectElement).value=theme;
  ($('language-select') as HTMLSelectElement).value=language;
  $('theme-select').onchange=()=>{theme=($('theme-select') as HTMLSelectElement).value;localStorage.setItem('steam-atlas-theme',theme);document.documentElement.dataset.theme=theme;renderChart();};
  $('language-select').onchange=()=>{localStorage.setItem('steam-atlas-language',($('language-select') as HTMLSelectElement).value);location.reload();};
  $('sync-open').onclick=()=>{pollSync();($('sync-dialog') as HTMLDialogElement).showModal();};
  $('sync-close').onclick=()=>($('sync-dialog') as HTMLDialogElement).close();
  $('sync-start').onclick=()=>syncAction('start');$('sync-pause').onclick=()=>syncAction('pause');$('sync-refresh').onclick=refreshCatalog;
  updateDataLabel();
  chart=echarts.init($('chart'),null,{renderer:'canvas'});
  let previousWidth=chart.getWidth();
  resizeObserver=new ResizeObserver(()=>{const width=$('chart').clientWidth;chart.resize();if(width!==previousWidth&&data&&preset().mode==='words'&&state.layout==='word cloud')renderChart();previousWidth=width;});resizeObserver.observe($('chart'));
  $('nav').onclick=(e)=>{const button=(e.target as HTMLElement).closest<HTMLElement>('[data-view]');if(button) setView(button.dataset.view!);};
  $('app').addEventListener('change',e=>{const el=e.target as HTMLInputElement;const key=el.dataset.state;if(!key)return;state[key]=el.type==='checkbox'?String(el.checked):el.value;if(key==='left')state.aTags='';if(key==='right')state.bTags='';renderConfig();loadChart();});
  $('app').addEventListener('click',e=>{const el=(e.target as HTMLElement).closest<HTMLElement>('[data-picker]');if(el)openPicker(el.dataset.picker!);const chip=(e.target as HTMLElement).closest<HTMLElement>('[data-remove-tag]');if(chip){const key=chip.dataset.key!;state[key]=state[key].split('|').filter(t=>t!==chip.dataset.removeTag).join('|');renderFilterChips();loadChart();}});
  $('mobile-menu').onclick=()=>$('sidebar').classList.toggle('mobile-open');
  $('filters-open').onclick=()=>{ $('filter-drawer').hidden=false;$('shade').hidden=false; };
  $('shade').onclick=closeDrawer;
  document.querySelector('[data-close]')!.addEventListener('click',closeDrawer);
  $('taxonomy-open').onclick=()=>openPicker('browse');
  $('about-open').onclick=()=>($('about') as HTMLDialogElement).showModal();
  $('about-close').onclick=()=>($('about') as HTMLDialogElement).close();
  $('reset-filters').onclick=()=>{for(const key of ['start','end','minReviews','type','price','include','exclude','undated'])state[key]=defaults[key];syncFilters();loadChart();};
  $('picker-close').onclick=()=>($('picker') as HTMLDialogElement).close();
  $('picker-done').onclick=applyPicker;
  $('tag-search').oninput=renderPicker;
  $('picker-clear').onclick=()=>{pickerSelected.clear();renderPicker();};
  $('picker-all').onclick=()=>{document.querySelectorAll<HTMLInputElement>('#taxonomy-grid input').forEach(el=>pickerSelected.add(el.value));renderPicker();};
  $('taxonomy-grid').onchange=e=>{const el=e.target as HTMLInputElement;if(el.checked)pickerSelected.add(el.value);else pickerSelected.delete(el.value);renderPicker();};
  $('details-close').onclick=()=>($('details') as HTMLDialogElement).close();
  $('details-prev').onclick=()=>{detailOffset=Math.max(0,detailOffset-50);loadDetails();};
  $('details-next').onclick=()=>{detailOffset+=50;loadDetails();};
  $('data-tab').onclick=()=>{const hidden=$('data-table').hidden;$('data-table').hidden=!hidden;$('data-tab').classList.toggle('active',hidden);if(hidden)renderTable();};
  $('data-table').onclick=e=>{const button=(e.target as HTMLElement).closest<HTMLElement>('[data-pair-index]');if(button&&data){const row=data.rows[Number(button.dataset.pairIndex)];openDetails(row.a,row.b);}};
  $('share-link').onclick=async()=>{updateURL();try{await navigator.clipboard.writeText(location.href);notify('View link copied. Filters and chart settings are included.');}catch{notify('Copy the URL from your address bar to share this view.');}};
  $('export-open').onclick=()=>{const menu=$('export-menu');menu.hidden=!menu.hidden;const rect=$('export-open').getBoundingClientRect();menu.style.top=`${rect.bottom+8}px`;menu.style.left=`${Math.max(8,rect.right-236)}px`;};
  $('export-menu').onclick=e=>{const el=(e.target as HTMLElement).closest<HTMLElement>('[data-export]');if(el){exportData(el.dataset.export!);$('export-menu').hidden=true;}};
  let searchTimer:ReturnType<typeof setTimeout>;
  $('game-search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(searchGames,200);};
  document.addEventListener('click',e=>{if(!(e.target as HTMLElement).closest('.search-container'))$('search-results').hidden=true;if(!(e.target as HTMLElement).closest('#export-menu,#export-open'))$('export-menu').hidden=true;});
  document.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','SELECT','TEXTAREA'].includes((e.target as HTMLElement).tagName)){e.preventDefault();$('game-search').focus();}if(e.key==='Escape'){closeDrawer();$('search-results').hidden=true;}});
  chart.on('click',(params:any)=>{if(preset().mode==='pairs'&&params.data?.pair)openDetails(params.data.pair.a,params.data.pair.b);else if(params.data?.game)showGame(params.data.game);else if(preset().mode==='themes'&&params.name){state.include=[...new Set([...state.include.split('|').filter(Boolean),params.name])].join('|');syncFilters();loadChart();}else if(preset().mode==='words'&&params.name){($('game-search') as HTMLInputElement).value=params.name;searchGames();}});
  syncFilters();renderConfig();refreshIcons();
}
function closeDrawer(){ $('filter-drawer').hidden=true;$('shade').hidden=true; }
function setView(id:string){state.view=id;state.aTags=preset().mode==='pairs'?originalGenres:'';state.bTags=id==='genre-genre'?originalGenres:id==='genre-theme'?originalThemes:id==='genre-perspective'?originalPerspectives:'';state.minCommon='1';state.limit=id==='words'?'80':id==='deck-best'?'20':id==='positive'?'50':'30';state.layout=id==='words'?'word cloud':id==='deck-best'?'scatter':id==='dimensions'?'stacked':'treemap';state.share=['dimensions','female','lgbtq','deck-releases'].includes(id)?'true':'false';state.period=['female','lgbtq','deck-releases'].includes(id)?'month':'year';state.rank=id==='negative'?'negative':id==='deck-best'?'rate':'reviews';Object.assign(state,preset().params||{});state.xLog='true';state.yLog='true';$('nav').innerHTML=navHTML();$('sidebar').classList.remove('mobile-open');renderConfig();loadChart();}
function renderConfig(){
  const p=preset();const pair=p.mode==='pairs';
  $('config').dataset.pairs=String(pair);
  $('eyebrow').innerHTML=`${p.section}<span> / </span>${pair?'PAIRS EXPLORER':'CATALOG EXPLORER'}`;
  $('hero-title').innerHTML=pair?'Every combination.<br><span>A different story.</span>':p.mode.startsWith('deck_')?'One genre.<br><span>A thousand possibilities.</span>':p.mode==='words'?'The words we play.<br><span>The stories they tell.</span>':p.mode==='ratings'?'What players think.<br><span>Written in the reviews.</span>':'A catalog in motion.<br><span>See the bigger picture.</span>';
  $('hero-description').textContent=pair?'Explore how Steam tags intersect. Find connections hiding in the catalog.':'Explore the original Steam dataset. Change the selection and watch the story unfold.';
  $('view-label').textContent=pair?'Pairs explorer':p.mode.startsWith('deck_')?'Deckbuilder explorer':'Catalog explorer';
  $('chart-title').textContent=pair?`${state.left} × ${state.right}`:p.mode.startsWith('deck_')?`Roguelike Deckbuilders · ${p.label}`:p.label;
  $('chart-kicker').textContent=pair?'TAG COMBINATIONS':p.mode.startsWith('deck_')?'A CLOSER LOOK':'THE STEAM CATALOG';
  $('original-link').setAttribute('href',`https://public.flourish.studio/visualisation/${p.source}/`);
  const familySelect=(key:string,label:string)=>`<label class="config-field">${label}<select data-state="${key}">${selectOptions(groups(),state[key])}</select></label>`;
  let html='';
  if(pair)html=`${familySelect('left','FIRST TAG FAMILY')}<button class="tag-customize" data-picker="aTags">${icon('list-filter')}${state.aTags?state.aTags.split('|').length+' tags':'All tags'}</button><span class="multiply">×</span>${familySelect('right','SECOND TAG FAMILY')}<button class="tag-customize" data-picker="bTags">${icon('list-filter')}${state.bTags?state.bTags.split('|').length+' tags':'All tags'}</button><div class="config-spacer"></div><label class="config-field short">MIN. SHARED GAMES<input type="number" min="0" data-state="minCommon" value="${esc(state.minCommon)}"></label>`;
  else if(['releases','deck_releases','dimensions','representation'].includes(p.mode))html=`<label class="config-field">GROUP RELEASES BY<select data-state="period">${selectOptions(['year','month'],state.period)}</select></label>${p.mode==='dimensions'?`<label class="config-field">DISPLAY<select data-state="layout">${selectOptions(['stacked','lines'],state.layout)}</select></label><label class="check-field"><input type="checkbox" data-state="dim25" ${state.dim25==='true'?'checked':''}>Include 2.5D</label>`:''}${['dimensions','representation','deck_releases'].includes(p.mode)?`<label class="check-field"><input type="checkbox" data-state="share" ${state.share==='true'?'checked':''}>${p.mode==='dimensions'&&state.layout==='stacked'?'Show % of dimension tags':'Show % of releases'}</label>`:''}<span class="config-hint">${icon('calendar-days')}The current year may be partial</span>`;
  else if(p.mode==='ratings'||p.mode==='deck_best')html=`<label class="config-field">RANK GAMES BY<select data-state="rank"><option value="reviews" ${state.rank==='reviews'?'selected':''}>Review count</option><option value="wilson" ${state.rank==='wilson'?'selected':''}>Wilson score (95% lower bound)</option><option value="rate" ${state.rank==='rate'?'selected':''}>Positive review percentage</option><option value="negative" ${state.rank==='negative'?'selected':''}>Negative review percentage</option></select></label><label class="config-field short">SHOW TOP<input type="number" min="1" max="100" data-state="limit" value="${state.limit}"></label>${p.mode==='deck_best'?`<label class="config-field">DISPLAY<select data-state="layout">${selectOptions(['scatter','bars'],state.layout)}</select></label>`:''}<span class="config-hint">${icon('mouse-pointer-2')}Click to inspect a game</span>`;
  else if(p.mode==='themes'||p.mode==='words')html=`${p.mode==='themes'?familySelect('group','TAG FAMILY'):''}<label class="config-field short">SHOW TOP<input type="number" min="1" max="150" data-state="limit" value="${state.limit}"></label><label class="config-field">DISPLAY<select data-state="layout">${selectOptions(p.mode==='words'?['word cloud','treemap','bars']:['treemap','bars'],state.layout)}</select></label><span class="config-hint">${icon('mouse-pointer-2')}${p.mode==='themes'?'Click a tag to filter the catalog':'Click a word to find matching titles'}</span>`;
  else html=`<span class="config-hint">${icon('scan-search')}Search a game above to highlight its release and reviews</span><span class="config-hint">Cohort tags matched within the snapshot</span>`;
  if(p.mode.startsWith('deck_'))html+=`<label class="config-field">DECKBUILDER COHORT<select data-state="deckScope"><option value="broad" ${state.deckScope==='broad'?'selected':''}>Roguelike + card tags</option><option value="tag" ${state.deckScope==='tag'?'selected':''}>Exact Deckbuilder tag</option></select></label>${p.mode==='deck_best'?`<label class="config-field short">MIN. RANKING REVIEWS<input type="number" min="1" data-state="bestMinReviews" value="${esc(state.bestMinReviews)}"></label>`:''}`;
  $('config').innerHTML=html;
  const metrics:Record<string,string>={x:'Games in either tag (union)',y:'Games in both tags',jaccard:'Overlap · Jaccard (%)',lift:'Association · Lift',countA:'Games in first tag',countB:'Games in second tag'};
  $('chart-options').innerHTML=pair?`<label>X axis<select data-state="xMetric">${Object.entries(metrics).map(([v,n])=>`<option value="${v}" ${state.xMetric===v?'selected':''}>${n}</option>`).join('')}</select></label><label>Y axis<select data-state="yMetric">${Object.entries(metrics).map(([v,n])=>`<option value="${v}" ${state.yMetric===v?'selected':''}>${n}</option>`).join('')}</select></label><div class="scale-toggles"><label><input type="checkbox" data-state="xLog" ${state.xLog==='true'?'checked':''}>Log X</label><label><input type="checkbox" data-state="yLog" ${state.yLog==='true'?'checked':''}>Log Y</label></div>`:p.mode==='deck_reviews'?`<label class="check-field"><input type="checkbox" data-state="yLog" ${state.yLog==='true'?'checked':''}>Logarithmic review scale</label><span class="muted">Scroll to zoom · drag the zoom slider to explore</span>`:p.mode==='dimensions'&&state.layout==='stacked'?'<span class="muted">A game may carry multiple dimension tags. Proportions normalize tag counts to 100% per period.</span>':'';
  if(p.mode==='deck_reviews')$('chart-options').innerHTML+=`<label class="check-field"><input type="checkbox" data-state="references" ${state.references==='true'?'checked':''}>Original reference markers</label>`;
  $('chart-options').hidden=!$('chart-options').innerHTML;
  $('chart-legend').innerHTML=`<i style="background:${pair?'#aa99fa':p.mode.startsWith('deck_')?'#ea9a32':'#60c5b0'}"></i>${pair?'Each dot is a tag combination · click to explore games':p.mode==='deck_reviews'?'Each dot is a game · dated records with reviews only':'Hover to explore the underlying values'}`;
  refreshIcons();
}
function syncFilters(){document.querySelectorAll<HTMLInputElement|HTMLSelectElement>('#filter-drawer [data-state]').forEach(el=>{if(el instanceof HTMLInputElement&&el.type==='checkbox')el.checked=state[el.dataset.state!]==='true';else el.value=state[el.dataset.state!];});renderFilterChips();}
function renderFilterChips(){for(const key of ['include','exclude'])$(key+'-chips').innerHTML=state[key].split('|').filter(Boolean).map(t=>`<button class="chip" data-key="${key}" data-remove-tag="${esc(t)}">${esc(t)}${icon('x')}</button>`).join('');refreshIcons();}
function queryParams(){const p=preset();return {...state,...p.params,chart:p.mode,...(p.mode==='pairs'?{left:state.left,right:state.right}:{}),limit:String(Math.min(150,Math.max(1,Number(state.limit)||30)))};}
async function loadChart(){
  if(state.start>state.end){notify('Start date must be before end date.');return;}
  controller?.abort();const request=new AbortController();controller=request;$('loading').hidden=false;$('chart-message').hidden=true;
  updateURL();const began=performance.now();
  const activeFilters=['start','end','minReviews','type','price','include','exclude','undated'].filter(k=>state[k]!==defaults[k]).length;
  $('filter-count').textContent=String(activeFilters);
  try{data=await api('chart',queryParams(),request.signal);if(selected){const checked=await api('search',{...queryParams(),q:String(selected.id)},request.signal);selected=checked.find((g:Row)=>g.canHighlight)||null;if(!selected)delete state.highlight;}lastDuration=Math.round(performance.now()-began);renderChart();renderStats();renderInsights();if(!$('data-table').hidden)renderTable();renderHighlight();if(($('game-search') as HTMLInputElement).value.trim())searchGames();}
  catch(e){if((e as Error).name==='AbortError')return;$('chart-message').innerHTML=`${icon('circle-alert')}<h3>Unable to load this selection</h3><p>${esc((e as Error).message)}</p><button id="retry-chart">Try again</button>`;$('chart-message').hidden=false;$('retry-chart').onclick=loadChart;refreshIcons();}
  finally{if(!request.signal.aborted)$('loading').hidden=true;}
}
function renderStats(){if(!data)return;const s=data.stats;const coverage=s.games?s.reviewed/s.games*100:0;
  const values=[['GAMES IN SELECTION',number(s.games),`${number(data.matched)} records match filters`], [preset().mode==='pairs'?'TAG COMBINATIONS':'CHART RECORDS',number(data.rows.length),preset().mode==='pairs'?`${state.left} × ${state.right}`:'Generated from the selection'],['TOTAL REVIEWS',compact(s.reviews),`${number(s.reviews)} player reviews`],['REVIEW COVERAGE',`${coverage.toFixed(1)}%`,`${number(s.reviewed)} games with reviews`]];
  $('stats').innerHTML=values.map(([label,value,note],i)=>`<div class="stat"><span>${label}${icon(['gamepad-2','waypoints','messages-square','chart-pie'][i])}</span><strong>${value}</strong><small>${esc(note)}</small></div>`).join('');
  $('calculation').innerHTML=`<span class="live-dot"></span>Recalculated · ${lastDuration} ms <span class="footer-divider">/</span> ${data.elapsedMs} ms query`;
  refreshIcons();
}
function renderInsights(){if(!data)return;$('insights').innerHTML=data.insights.map((r,i)=>`<article class="insight"><span class="insight-label"><i>0${i+1}</i>${esc(r.label)}</span><h3>${esc(r.value)}</h3><p>${esc(r.detail)}</p></article>`).join('');}
const palette=['#ac96f8','#64c6b3','#eea34a','#ee8cae','#6cbde7','#c3cb75','#c498d9'];
function layoutWords(rows:Row[],width:number,height:number){
  const context=document.createElement('canvas').getContext('2d')!;
  const boxes: {x:number;y:number;w:number;h:number}[]=[];
  const words:Row[]=[];
  const maximum=rows[0]?.value||1;
  for(const row of rows){
    const size=Math.max(12,Math.min(width/13,68)*Math.sqrt(row.value/maximum));
    context.font=`600 ${size}px Manrope, Segoe UI, sans-serif`;
    const w=context.measureText(row.name).width+12,h=size+10;
    for(let step=0;step<2200;step++){
      const angle=step*0.16,radius=3.7*Math.sqrt(step);
      const cx=width/2+Math.cos(angle)*radius*(width/height)*1.35,cy=height/2+Math.sin(angle)*radius;
      const box={x:cx-w/2,y:cy-h/2,w,h};
      if(box.x<22||box.y<18||box.x+w>width-22||box.y+h>height-18)continue;
      if(boxes.some(b=>box.x<b.x+b.w&&box.x+w>b.x&&box.y<b.y+b.h&&box.y+h>b.y))continue;
      boxes.push(box);words.push({...row,cx,cy,size});break;
    }
  }
  return words;
}
function renderChart(){
  if(!data)return;
  const mode=preset().mode;
  const tooltip={backgroundColor:'#fcfbff',borderColor:'#d7d1e7',padding:16,textStyle:{color:'#29233f',fontFamily:'Inter, Segoe UI, sans-serif'},extraCssText:'border-radius:12px;box-shadow:0 12px 40px #0b08164d;max-width:330px;',confine:true};
  const grid={left:86,right:38,top:30,bottom:82};
  const light=theme==='light';
  const axis={axisLine:{lineStyle:{color:light?'#cbd5e1':'#9287b5'}},axisTick:{show:false},axisLabel:{color:light?'#667085':'#bcb5d0',fontSize:11},splitLine:{lineStyle:{color:light?'#e8edf4':'#ffffff14'}},nameTextStyle:{color:light?'#344054':'#d9d3e8',fontSize:12,fontWeight:600},nameGap:44};
  let option:any={backgroundColor:light?'#ffffff':'#282247',textStyle:{fontFamily:'Inter, Segoe UI, sans-serif',color:light?'#344054':'#d9d3e8'},animationDuration:350,tooltip,grid};
  let rows=data.rows;
  if(mode==='pairs'){
    const metricLabels:Record<string,string>={x:'Games in either tag (union)',y:'Games in both tags (intersection)',jaccard:'Overlap · Jaccard (%)',lift:'Association · Lift',countA:'Games in first tag',countB:'Games in second tag'};
    const xl=state.xLog==='true',yl=state.yLog==='true';
    rows=rows.filter(r=>(!xl||r[state.xMetric]>0)&&(!yl||r[state.yMetric]>0));
    const highlighted=(r:Row)=>selected&&selected.tags.includes(r.a)&&selected.tags.includes(r.b);
    option.xAxis={...axis,type:xl?'log':'value',logBase:10,name:metricLabels[state.xMetric],nameLocation:'middle',min:xl?undefined:0,axisLabel:{...axis.axisLabel,formatter:compact}};
    option.yAxis={...axis,type:yl?'log':'value',logBase:10,name:metricLabels[state.yMetric],nameLocation:'middle',nameGap:62,min:yl?undefined:0,axisLabel:{...axis.axisLabel,formatter:compact}};
    option.tooltip={...tooltip,formatter:(p:any)=>{const r=p.data.pair;return `<div class="tip-eyebrow">TAG COMBINATION</div><b>${esc(r.a)} <span>×</span> ${esc(r.b)}</b><dl><dt>Games in either tag</dt><dd>${number(r.x)}</dd><dt>Games in both tags</dt><dd>${number(r.y)}</dd><dt>${esc(r.a)}</dt><dd>${number(r.countA)}</dd><dt>${esc(r.b)}</dt><dd>${number(r.countB)}</dd><dt>Jaccard overlap</dt><dd>${r.jaccard}%</dd><dt>Lift</dt><dd>${r.lift}×</dd></dl><div class="tip-foot">Click to explore the games behind this pair →</div>`;}};
    option.series=[{type:'scatter',symbolSize:11,data:rows.map(r=>({value:[r[state.xMetric],r[state.yMetric]],pair:r,symbolSize:highlighted(r)?15:11,itemStyle:{color:highlighted(r)?'#92dc69':'#ac96f8',opacity:selected?(highlighted(r)?1:0.2):0.78,borderColor:highlighted(r)?'#d9ffb9':undefined,borderWidth:highlighted(r)?2:0}})),emphasis:{scale:1.6,itemStyle:{opacity:1,shadowBlur:15,shadowColor:'#bca9ff'}}}];
    option.dataZoom=[{type:'inside',xAxisIndex:0,filterMode:'none'},{type:'inside',yAxisIndex:0,filterMode:'none'}];
  } else if(mode==='deck_reviews'){
    option.xAxis={...axis,type:'time',name:'Release date',nameLocation:'middle'};
    option.yAxis={...axis,type:state.yLog==='true'?'log':'value',name:'Player reviews',nameLocation:'middle',nameGap:60,axisLabel:{...axis.axisLabel,formatter:compact}};
    option.tooltip={...tooltip,formatter:(p:any)=>gameTooltip(p.data.game)};
    const highlightRow=selected&&rows.find(r=>r.id===selected!.id);
    const referenceNames=state.references==='true'?['Slay the Spire','Inscryption','Balatro']:[];
    const referenceRows=rows.filter(r=>referenceNames.includes(r.name));
    const markers=[...referenceRows,...(highlightRow&&!referenceRows.some(r=>r.id===highlightRow.id)?[highlightRow]:[])];
    option.series=[{type:'scatter',symbolSize:9,data:rows.map(r=>({value:[r.date,r.reviews],game:r,symbolSize:r.id===selected?.id?16:9,itemStyle:{color:r.id===selected?.id||referenceNames.includes(r.name)?'#95dc66':state.references==='true'&&r.rating==='Overwhelmingly Negative'?'#ee586d':'#e49b38',opacity:selected?(r.id===selected.id?1:0.32):0.83}})),markLine:markers.length?{silent:true,symbol:'none',lineStyle:{color:'#cfe5b9',type:'dashed',opacity:0.7},label:{color:'#eefae8',position:'insideEndTop',rotate:90,fontSize:11},data:markers.map(r=>({name:r.name,xAxis:r.date,label:{formatter:r.name}}))}:undefined}];
    option.dataZoom=[{type:'inside',xAxisIndex:0},{type:'slider',xAxisIndex:0,bottom:14,height:16,textStyle:{color:'#aea4c9'},borderColor:'#494062',fillerColor:'#ac96f822',handleStyle:{color:'#ac96f8'},dataBackground:{areaStyle:{color:'#ac96f8'}}}];
  }else if(mode==='themes'||mode==='words'){
    const layout=state.layout;
    if(layout==='word cloud'&&mode==='words'){
      const words=layoutWords(rows,chart.getWidth(),510);
      option.series=[{type:'custom',coordinateSystem:'none',data:words.map(w=>({name:w.name,value:w.value,word:w})),renderItem:(params:any)=>{const w=words[params.dataIndex];return {type:'text',x:w.cx,y:w.cy,style:{text:w.name,fontSize:w.size,fontFamily:'Manrope, Segoe UI, sans-serif',fontWeight:600,fill:light?['#5972d9','#16896e','#ac731e','#bd5578','#2c85b9','#788924','#925eb5'][params.dataIndex%7]:palette[params.dataIndex%palette.length],align:'center',verticalAlign:'middle'},emphasis:{style:{fill:light?'#1d2939':'#ffffff'}}};}}];
    } else if(layout==='bars'){
      option.grid={left:140,right:65,top:15,bottom:30};option.xAxis={...axis,type:'value',axisLabel:{...axis.axisLabel,formatter:compact}};option.yAxis={...axis,type:'category',inverse:true,data:rows.slice(0,30).map(r=>r.name),splitLine:{show:false}};option.series=[{type:'bar',data:rows.slice(0,30).map((r,i)=>({...r,itemStyle:{color:palette[i%palette.length],borderRadius:[0,4,4,0]}})),label:{show:true,position:'right',color:'#ddd5f0',formatter:(p:any)=>compact(p.value)},barMaxWidth:16}];
    }else option.series=[{type:'treemap',data:rows,roam:false,nodeClick:false,breadcrumb:{show:false},width:'95%',height:'93%',top:12,left:'2.5%',color:palette,label:{show:true,formatter:(p:any)=>`${p.name}\n${number(p.value)}`,color:'#221b38',fontSize:15,fontWeight:600,lineHeight:24},itemStyle:{borderColor:'#282247',borderWidth:4,gapWidth:4,borderRadius:4},levels:[{colorMappingBy:'index',itemStyle:{borderWidth:0,gapWidth:4}}]}];
    option.tooltip={...tooltip,formatter:(p:any)=>`<b>${esc(p.name)}</b><dl><dt>Games ${mode==='words'?'with this word':'with this tag'}</dt><dd>${number(p.value)}</dd>${p.data.share!==undefined?`<dt>Of selection</dt><dd>${p.data.share}%</dd>`:''}</dl>`};
  }else if(mode==='deck_best'&&state.layout==='scatter'){
    option.xAxis={...axis,type:'log',name:'Player reviews',nameLocation:'middle',axisLabel:{...axis.axisLabel,formatter:compact}};
    option.yAxis={...axis,type:'value',name:'Positive review ratio (%)',nameLocation:'middle',nameGap:62,min:'dataMin',max:100,axisLabel:{...axis.axisLabel,formatter:(n:number)=>n+'%'}};
    option.series=[{type:'scatter',symbolSize:13,data:rows.map(r=>({name:r.name,value:[r.reviews,r.positiveRate],game:r,itemStyle:{color:r.id===selected?.id?'#95dc66':'#ac96f8',opacity:selected?(r.id===selected.id?1:0.4):0.85}})),label:{show:true,formatter:'{b}',fontSize:10,color:'#cdbbe6',position:'top'},labelLayout:{hideOverlap:true},emphasis:{scale:1.5}}];
    option.tooltip={...tooltip,formatter:(p:any)=>gameTooltip(p.data.game)};
  }else if(mode==='ratings'||mode==='deck_best'){
    const field=state.rank==='wilson'?'wilson':state.rank==='rate'?'positiveRate':state.rank==='negative'?'negativeRate':'reviews';
    option.grid={left:chart.getWidth()<600?140:225,right:50,top:15,bottom:48};
    option.xAxis={...axis,type:'value',name:state.rank==='reviews'?'Player reviews':state.rank==='wilson'?'Wilson score (%)':state.rank==='negative'?'Negative reviews (%)':'Positive reviews (%)',nameLocation:'middle',max:state.rank==='reviews'?undefined:100,axisLabel:{...axis.axisLabel,formatter:compact}};
    option.yAxis={...axis,type:'category',data:rows.map(r=>r.name),inverse:true,splitLine:{show:false},axisLabel:{color:'#d4cbe7',fontSize:chart.getWidth()<600?9:11,width:chart.getWidth()<600?118:200,overflow:'truncate'}};
    option.series=[{type:'bar',data:rows.map(r=>({value:r[field],game:r,itemStyle:{color:r.id===selected?.id?'#95dc66':preset().id==='negative'?'#f18b9e':'#ac96f8',borderRadius:[0,4,4,0],opacity:selected?(r.id===selected.id?1:0.4):1}})),barMaxWidth:18,label:{show:true,position:'right',color:'#d4cbe7',fontSize:10,formatter:(p:any)=>state.rank==='reviews'?compact(p.value):p.value+'%'}}];
    option.tooltip={...tooltip,formatter:(p:any)=>gameTooltip(p.data.game)};
  }else{
    const percent=state.share==='true';
    option.xAxis={...axis,type:'category',data:rows.map(r=>r.period),boundaryGap:!['dimensions','representation'].includes(mode),name:state.period==='year'?'Release year':'Release month',nameLocation:'middle'};
    const stacked=mode==='dimensions'&&state.layout==='stacked';
    option.yAxis={...axis,type:'value',name:percent?(stacked?'Share of dimension tags (%)':'Share of releases (%)'):'Games released',nameLocation:'middle',nameGap:62,max:stacked&&percent?100:undefined,axisLabel:{...axis.axisLabel,formatter:percent?(n:number)=>n+'%':compact}};
    option.tooltip={...tooltip,trigger:'axis',formatter:(params:any[])=>`<b>${esc(params[0]?.axisValue)}</b><dl>${params.map(p=>`<dt>${esc(p.seriesName)}</dt><dd>${percent?p.value+'%':number(p.value)}</dd>`).join('')}</dl>`};
    option.series=data.series.length?data.series.map((s,i)=>({name:s.name,type:stacked?'bar':'line',stack:stacked?'dimensions':undefined,barMaxWidth:26,smooth:false,symbolSize:mode==='releases'?4:6,data:percent?(stacked?s.composition:s.shares):s.values,lineStyle:{width:mode==='releases'?2:3,color:palette[i]},itemStyle:{color:palette[i]},areaStyle:mode==='releases'||data!.series.length===1?{color:palette[i],opacity:0.1}:undefined})): [{name:'Games released',type:'bar',data:rows.map(r=>r.count),itemStyle:{color:mode==='deck_releases'?'#eaa242':'#ac96f8',borderRadius:[4,4,0,0]},barMaxWidth:26}];
    if(data.series.length)option.legend={data:data.series.map(s=>s.name),textStyle:{color:'#d5cde6'},top:0};
    if(rows.length>50)option.dataZoom=[{type:'inside'},{type:'slider',height:14,bottom:12,textStyle:{color:'#aca3c3'},borderColor:'#494062',fillerColor:'#ac96f822'}];
  }
  const taller=(mode==='ratings'||(mode==='deck_best'&&state.layout!=='scatter')||((mode==='themes'||mode==='words')&&state.layout==='bars'))?Math.max(510,Math.min(rows.length,100)*25+70):510;
  const adjust=(value:any,key=''):any=>{
    if(typeof value==='string'){
      if(key==='color'&&light)return ({'#d4cbe7':'#475467','#d5cde6':'#475467','#d9d3e8':'#344054','#ddd5f0':'#475467','#cdbbe6':'#475467','#aea4c9':'#667085','#ac96f8':'#6a82ef','#92dc69':'#39a463','#95dc66':'#39a463','#ac96f822':'#4f6fed22','#494062':'#dce2ec','#cfe5b9':'#39875b','#eefae8':'#35754a'} as Record<string,string>)[value]||value;
      if(key==='borderColor'&&value==='#282247'&&light)return '#ffffff';
      if(key==='name'||key==='text')return t(value);
      return value;
    }
    if(typeof value==='function'&&key==='formatter')return (...args:any[])=>{const result=value(...args);return typeof result==='string'?translateHTML(result):result;};
    if(Array.isArray(value))return value.map(v=>adjust(v,key));
    if(value&&typeof value==='object'){const result:any={};for(const [k,v] of Object.entries(value))result[k]=k==='game'||k==='pair'?v:adjust(v,k);return result;}
    return value;
  };
  if(mode==='ratings'||(mode==='deck_best'&&state.layout!=='scatter'))option.yAxis.data=rows.map(r=>gameName(r));
  if(mode==='deck_best'&&state.layout==='scatter')option.series[0].data.forEach((item:any)=>item.name=gameName(item.game));
  if(option.series?.[0]?.markLine)option.series[0].markLine.data.forEach((line:any)=>{const game=rows.find(r=>r.date===line.xAxis&&r.name===line.name);if(game){line.name=gameName(game);line.label.formatter=gameName(game);}});
  $('chart').style.height=`${taller}px`;chart.resize();chart.setOption(adjust(option),true);
  if(!rows.length){$('chart-message').innerHTML=`${icon('search-x')}<h3>No data for this selection</h3><p>${data.rows.length?'Zero values cannot be plotted on a logarithmic axis. Switch to a linear scale.':'Try a wider date range, fewer required tags, or a lower review threshold.'}</p>`;$('chart-message').hidden=false;refreshIcons();}
  else $('chart-message').hidden=true;
}
function gameTooltip(g:Row){return `<div class="tip-eyebrow">${esc(g.rating)}</div><b data-name>${esc(gameName(g))}</b><dl><dt>Release date</dt><dd>${esc(g.date||'Undated / upcoming')}</dd><dt>Total reviews</dt><dd>${number(g.reviews)}</dd><dt>Positive reviews</dt><dd>${g.positiveRate===null?'No reviews':g.positiveRate+'%'}</dd><dt>Wilson score</dt><dd>${g.wilson}%</dd><dt>Updated at</dt><dd>${esc(g.updated_at?new Date(g.updated_at).toLocaleString(language==='zh'?'zh-CN':'en-US'):'2024-10')}</dd></dl><div class="tip-foot">${esc(g.tags.slice(0,5).join(' · '))}</div>`;}
async function searchGames(){
  const query=($('game-search') as HTMLInputElement).value.trim();const version=++searchVersion;
  if(!query){$('search-results').hidden=true;return;}
  const params=queryParams();const signature=JSON.stringify(params);
  try{
    const results:Row[]=await api('search',{...params,q:query});
    if(version!==searchVersion||signature!==JSON.stringify(queryParams()))return;
    $('search-results').hidden=false;
    $('search-results').innerHTML=results.length?results.map((g,i)=>`<button data-result="${i}" ${g.canHighlight?'':'disabled'} title="${esc(t(g.highlightReason))}"><div><strong data-name>${esc(gameName(g))}</strong><small>${esc(g.date||'Undated / upcoming')} · ${number(g.reviews)} reviews</small>${language==='zh'&&g.name_zh?`<small data-name>${esc(g.name)}</small>`:''}<small>${esc(t(g.highlightReason))}</small></div><span class="${g.canHighlight?'':'unavailable-label'}">${g.canHighlight?icon('crosshair'):t('Unavailable')}</span></button>`).join(''):'<p>No matching game in the catalog.</p>';
    $('search-results').onclick=e=>{const button=(e.target as HTMLElement).closest<HTMLButtonElement>('[data-result]');if(!button||button.disabled)return;const result=results[Number(button.dataset.result)];if(!result.canHighlight)return;selected=result;state.highlight=String(selected.id);updateURL();$('search-results').hidden=true;($('game-search') as HTMLInputElement).value='';renderChart();renderHighlight();};refreshIcons();
  }catch{notify(t('Game search is unavailable. Check the local server.'));}
}
function renderHighlight(){if(!selected){$('highlight').hidden=true;return;}$('highlight').hidden=false;
  const mode=preset().mode;
  const matches=mode==='pairs'?data?.rows.filter(r=>selected!.tags.includes(r.a)&&selected!.tags.includes(r.b)).length||0:data?.rows.filter(r=>r.id===selected!.id).length||0;
  let note=mode==='pairs'?`${matches} combinations carry both of this game’s tags.`:matches?'Highlighted in this chart.':selected.highlightReason||'Outside the selected rating or ranking limit.';
  if(!selected.date&&mode==='deck_reviews')note='No release date in this snapshot. This game cannot be placed on the time axis.';
  if(!['pairs','deck_reviews','ratings','deck_best'].includes(mode))note='Game details available. Individual games are not plotted in this aggregate view.';
  $('highlight').innerHTML=`<span class="highlight-dot"></span><div><strong>${esc(gameName(selected))}</strong><small>${esc(note)}</small></div><button id="highlight-details">Details ${icon('arrow-up-right')}</button><button id="highlight-clear" aria-label="Clear highlighted game">${icon('x')}</button>`;
  $('highlight-clear').onclick=()=>{selected=null;delete state.highlight;updateURL();renderHighlight();renderChart();};$('highlight-details').onclick=()=>showGame(selected!);refreshIcons();
}
let pickerSelected=new Set<string>();
function openPicker(target:string){pickerTarget=target;const family=target==='aTags'?state.left:state.right;pickerSelected=new Set(target==='browse'?[]:state[target]?state[target].split('|'):['aTags','bTags'].includes(target)?meta.taxonomy[family].tags:[]);$('picker-title').textContent=target==='browse'?'Explore tag families':target==='include'?'Require these tags':target==='exclude'?'Exclude these tags':`Choose ${family.toLowerCase()} tags`;
  $('picker-description').textContent=target==='browse'?'The reference taxonomy, reconstructed from Steamworks. Tags can belong to multiple families.':target==='include'?'Only games with every selected tag will be included.':target==='exclude'?'Games with any selected tag will be excluded.':'These tags form the candidate combinations. At least one tag must remain selected.';
  ($('tag-search') as HTMLInputElement).value='';$('picker-done').textContent=target==='browse'?'Done':'Apply selection';$('picker-clear').hidden=target==='browse';$('picker-all').hidden=target==='browse';renderPicker();($('picker') as HTMLDialogElement).showModal();}
function renderPicker(){const q=($('tag-search') as HTMLInputElement).value.toLowerCase();const group=pickerTarget==='aTags'?state.left:pickerTarget==='bTags'?state.right:null;
  $('taxonomy-grid').innerHTML=Object.entries(meta.taxonomy).filter(([name])=>!group||name===group).map(([name,f])=>{const tags=f.tags.filter(t=>t.toLowerCase().includes(q));if(!tags.length)return '';return `<section class="family" style="--family:${f.color}"><h3><span></span>${esc(name)}<small>${tags.length}</small></h3><div>${tags.map(t=>pickerTarget==='browse'?`<span class="tag-label">${esc(t)}<small>${compact(meta.tagCounts[t])}</small></span>`:`<label class="tag-choice ${pickerSelected.has(t)?'chosen':''}"><input type="checkbox" value="${esc(t)}" ${pickerSelected.has(t)?'checked':''}><span>${esc(t)}</span><small>${compact(meta.tagCounts[t])}</small></label>`).join('')}</div></section>`;}).join('')||'<p class="muted">No tags match your search.</p>';
  $('picker-count').textContent=pickerTarget==='browse'?'Snapshot counts shown beside each tag':`${pickerSelected.size} tags selected`;}
function applyPicker(){if(pickerTarget!=='browse'){if(['aTags','bTags'].includes(pickerTarget)&&!pickerSelected.size){notify('Select at least one tag for this family.');return;}state[pickerTarget]=[...pickerSelected].sort().join('|');renderFilterChips();renderConfig();loadChart();}($('picker') as HTMLDialogElement).close();}
function gameTable(rows:Row[]){return `<div class="table-scroll"><table><thead><tr><th>Game</th><th>Released</th><th>Reviews</th><th>Positive</th><th>Wilson</th><th>Updated at</th></tr></thead><tbody>${rows.map(g=>`<tr><td><a href="https://store.steampowered.com/app/${g.id}/" target="_blank" rel="noopener">${esc(gameName(g))} ↗</a><small>${esc(g.tags.slice(0,4).join(' · '))}</small></td><td>${esc(g.date||'Undated')}</td><td>${number(g.reviews)}</td><td>${g.positiveRate===null?'—':g.positiveRate+'%'}</td><td>${g.wilson}%</td><td>${esc(g.updated_at?new Date(g.updated_at).toLocaleDateString(language==='zh'?'zh-CN':'en-US'):'2024-10')}</td></tr>`).join('')}</tbody></table></div>`;}
async function openDetails(a:string,b:string){detailPair={a,b};detailOffset=0;$('details-title').textContent=`${a} × ${b}`;($('details') as HTMLDialogElement).showModal();await loadDetails();}
async function loadDetails(){if(!detailPair)return;const version=++detailsVersion;$('details-content').innerHTML='<p class="muted">Loading matching games…</p>';try{const result=await api('games',{...state,...detailPair,offset:String(detailOffset)});if(version!==detailsVersion)return;$('details-count').textContent=`${number(result.total)} games carry both tags within the current filters. Sorted by review count.`;$('details-content').innerHTML=result.rows.length?gameTable(result.rows):'<p class="muted">No games carry both tags within the current filters.</p>';$('details-page').textContent=result.total?`${detailOffset+1}–${Math.min(detailOffset+50,result.total)} of ${number(result.total)}`:'0 games';($('details-prev') as HTMLButtonElement).disabled=detailOffset===0;($('details-next') as HTMLButtonElement).disabled=detailOffset+50>=result.total;}catch(e){$('details-content').textContent=(e as Error).message;}}
function showGame(g:Row){++detailsVersion;detailPair=null;$('details-title').textContent=gameName(g);$('details-count').textContent=`Steam App ${g.id} · ${g.rating} · ${g.free?'Free':'Not marked free'}`;$('details-content').innerHTML=gameTable([g])+`<div class="chips game-tags">${g.tags.map((t:string)=>`<span class="chip">${esc(t)}</span>`).join('')}</div>`;$('details-page').textContent=t('Updated at')+': '+(g.updated_at?new Date(g.updated_at).toLocaleString(language==='zh'?'zh-CN':'en-US'):'2024-10');($('details-prev') as HTMLButtonElement).disabled=true;($('details-next') as HTMLButtonElement).disabled=true;if(!($('details') as HTMLDialogElement).open)($('details') as HTMLDialogElement).showModal();}
function renderTable(){if(!data)return;if(!data.rows.length){$('data-table').innerHTML='<p class="muted">No rows to display.</p>';return;}if(data.rows[0].id){$('data-table').innerHTML=gameTable(data.rows.slice(0,100));return;}if(preset().mode==='pairs'){$('data-table').innerHTML=`<div class="table-scroll"><table><thead><tr><th>Tag combination</th><th>Either tag</th><th>Both tags</th><th>Overlap</th><th>Lift</th><th>Explore</th></tr></thead><tbody>${data.rows.slice(0,150).map((r,i)=>`<tr><td>${esc(r.a)} × ${esc(r.b)}</td><td>${number(r.x)}</td><td>${number(r.y)}</td><td>${r.jaccard}%</td><td>${r.lift}×</td><td><button class="table-action" data-pair-index="${i}">View games →</button></td></tr>`).join('')}</tbody></table></div><p class="table-note">Showing up to 150 rows. CSV exports all combinations.</p>`;return;}const keys=Object.keys(data.rows[0]);$('data-table').innerHTML=`<div class="table-scroll"><table><thead><tr>${keys.map(k=>`<th>${esc(k)}</th>`).join('')}</tr></thead><tbody>${data.rows.slice(0,150).map(r=>`<tr>${keys.map(k=>`<td>${esc(r[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="table-note">Showing up to 150 rows. CSV exports all chart rows.</p>`;}
function exportData(format:string){if(!data||!data.rows.length){notify('No chart data to export.');return;}let url:string;if(format==='png'){const source=chart.getDataURL({type:'png',pixelRatio:2,backgroundColor:theme==='light'?'#ffffff':'#282247'});const bytes=Uint8Array.from(atob(source.split(',')[1]),c=>c.charCodeAt(0));url=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));}else{const exportRows=data.series.length?data.rows.map((r,i)=>({...r,...Object.fromEntries(data!.series.flatMap(s=>[[s.name,s.values[i]],[s.name+' share (%)',s.shares[i]]]))})):data.rows;const keys=Object.keys(exportRows[0]);const cell=(v:unknown)=>{let s=Array.isArray(v)?v.join(' | '):String(v??'');if(/^[=+@-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};const csv=[keys.map(cell).join(','),...exportRows.map(r=>keys.map(k=>cell(r[k])).join(','))].join('\r\n');url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));}const anchor=document.createElement('a');anchor.href=url;anchor.download=`steam-atlas-${state.view}.${format}`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),5000);notify('Export downloaded.');}

let lastSyncTimestamp='';
let pollingSync=false;
function updateDataLabel(){
  const label=document.querySelector<HTMLElement>('.snapshot');
  if(label)label.textContent=meta.lastUpdatedAt?`${t('Partial update')}: ${new Date(meta.lastUpdatedAt).toLocaleString(language==='zh'?'zh-CN':'en-US')}`:'2024-10 '+t('Original dataset');
}
async function refreshCatalog(){
  meta=await api('meta');updateDataLabel();
  const note=document.querySelector('.intro-note small');if(note)note.textContent=`${number(meta.total)} records · ${meta.tags} tags`;
  if(selected){const games=await api('search',{...queryParams(),q:String(selected.id)});selected=games.find((g:Row)=>g.canHighlight)||null;if(!selected)delete state.highlight;}
  await loadChart();
}
async function syncAction(action:string){
  const button=$('sync-'+action) as HTMLButtonElement;button.disabled=true;
  try{
    const response=await fetch('/api/sync/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey:($('sync-key') as HTMLInputElement).value})});
    if(!response.ok)throw new Error((await response.json()).error||'Sync could not start');
    ($('sync-key') as HTMLInputElement).value='';await pollSync();
  }catch(error){notify(String(error));}finally{button.disabled=false;}
}
async function pollSync(){
  if(pollingSync)return;pollingSync=true;
  try{
    const status=await api('sync/status');const counts=status.counts;const completed=counts.done||0;const pending=(counts.pending||0)+(counts.working||0);
    const stamp=(value:string|null)=>value?new Date(value).toLocaleString(language==='zh'?'zh-CN':'en-US'):t('Not yet completed');
    const entries=[['Status',t(status.phase)],['Target date',status.targetDate||t('Not started')],['Latest record update',stamp(status.lastUpdatedAt)],['Last full pass',stamp(status.lastCompletedAt)],['Discovery source',status.discoverySource],['Coverage',status.discoveryCoverage],['Current App ID',status.currentApp||'—'],['Failed apps',counts.failed||0],['Unavailable apps',counts.unavailable||0]];
    $('sync-content').innerHTML=`<div class="sync-grid"><div><small>Completed apps</small><strong>${number(completed)}</strong></div><div><small>Pending apps</small><strong>${number(pending)}</strong></div><div><small>Chinese names</small><strong>${number(status.localized)}</strong></div></div><div class="sync-status"><progress max="${Math.max(status.total,1)}" value="${completed+(counts.unavailable||0)}"></progress><dl>${entries.map(([label,value])=>`<dt>${t(String(label))}</dt><dd>${esc(t(String(value)))}</dd>`).join('')}</dl>${status.lastError?`<p>${esc(status.lastError)}</p>`:''}</div>`;
    ($('sync-start') as HTMLButtonElement).disabled=status.running;($('sync-pause') as HTMLButtonElement).disabled=!status.running;
    const syncButton=$('sync-open');syncButton.innerHTML=`${icon('rotate-ccw')}${t('Sync data')}${status.running?` · ${number(completed)}`:''}`;
    localize($('sync-dialog'));refreshIcons();
    if(status.lastUpdatedAt&&status.lastUpdatedAt!==lastSyncTimestamp){lastSyncTimestamp=status.lastUpdatedAt;const next:Meta=await api('meta');if(next.lastUpdatedAt!==meta.lastUpdatedAt)await refreshCatalog();}
  }catch(error){if(($('sync-dialog') as HTMLDialogElement)?.open)$('sync-content').textContent=String(error);}
  finally{pollingSync=false;}
}
async function boot(){try{meta=await api('meta');shell();defaults.end=meta.today;if(!new URLSearchParams(location.search).has('end'))state.end=meta.today;if(state.highlight){const results=await api('search',{...queryParams(),q:state.highlight});selected=results.find((r:Row)=>String(r.id)===state.highlight&&r.canHighlight)||null;if(!selected)delete state.highlight;}await loadChart();await pollSync();setInterval(pollSync,4000);}catch(e){$('app').innerHTML=`<div class="boot-error"><h1>The catalog is offline.</h1><p>Start the local API with <code>python server.py</code>, then reload.</p><p>${esc((e as Error).message)}</p><button onclick="location.reload()">Reload</button></div>`;}}
boot();
