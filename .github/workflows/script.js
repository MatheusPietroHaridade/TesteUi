(() => {
  "use strict";

  const TYPES = {
    panel: {label:"Panel", desc:"Container", defaults:{size:[100,60], offset:[0,0]}},
    stack_panel: {label:"Stack Panel", desc:"Stack container", defaults:{size:[100,60], offset:[0,0]}},
    collection_panel: {label:"Collection Panel", desc:"Collection", defaults:{size:[100,60], offset:[0,0]}},
    scrolling_panel: {label:"Scrolling Panel", desc:"Scrollable", defaults:{size:[100,60], offset:[0,0]}},
    image: {label:"Image", desc:"Texture", defaults:{size:[64,64], offset:[0,0]}},
    label: {label:"Label", desc:"Text", defaults:{size:[100,20], offset:[0,0]}},
    button: {label:"Button", desc:"Clickable", defaults:{size:[100,30], offset:[0,0]}},
    input_panel: {label:"Input Panel", desc:"Input", defaults:{size:[100,30], offset:[0,0]}},
    toggle: {label:"Toggle", desc:"Switch", defaults:{size:[40,20], offset:[0,0]}},
    custom: {label:"Custom", desc:"Custom control", defaults:{size:[100,60], offset:[0,0]}}
  };

  let project = {
    format_version: 1,
    screen: {width:384,height:216},
    root: makeNode("panel", "root")
  };
  let selectedId = "root";
  let tool = "select";
  let panMode = false;
  let zoom = 1.5;
  let grid = true;
  let preview = false;
  let history = [];
  let historyIndex = -1;
  let dragState = null;
  let toastTimer = null;

  const $ = id => document.getElementById(id);
  const uiCanvas = $("uiCanvas");
  const canvasStage = $("canvasStage");
  const viewport = $("canvasViewport");
  const props = $("properties");
  const propsEmpty = $("propertiesEmpty");
  const jsonEditor = $("jsonEditor");

  function uid() {
    return "e_" + Math.random().toString(36).slice(2,10) + Date.now().toString(36).slice(-4);
  }

  function makeNode(type, name) {
    const t = TYPES[type] || TYPES.custom;
    return {
      id: uid(),
      name: name || (t.label.replace(/\s+/g,"_").toLowerCase()),
      type,
      offset: [...t.defaults.offset],
      size: [...t.defaults.size],
      anchor_from: "top_left",
      anchor_to: "top_left",
      layer: 0,
      alpha: 1,
      visible: true,
      enabled: true,
      children: [],
      text: type === "label" || type === "button" ? t.label : "",
      texture: "",
      bindings: [],
      variables: {}
    };
  }

  project.root.id = "root";

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function findNode(node,id) {
    if(node.id === id) return node;
    for(const c of node.children || []) { const found = findNode(c,id); if(found) return found; }
    return null;
  }

  function findParent(node,id,parent=null) {
    if(node.id === id) return parent;
    for(const c of node.children || []) {
      const found = findParent(c,id,node);
      if(found) return found;
    }
    return null;
  }

  function selected() { return findNode(project.root, selectedId) || project.root; }
  function parentOf(id) { return findParent(project.root,id); }

  function record(label="Change") {
    const snap = clone(project);
    history = history.slice(0, historyIndex + 1);
    history.push({label,snap});
    if(history.length > 60) history.shift();
    historyIndex = history.length - 1;
  }

  function undo() {
    if(historyIndex <= 0) return toast("Nothing to undo");
    historyIndex--;
    project = clone(history[historyIndex].snap);
    selectedId = findNode(project.root,selectedId) ? selectedId : "root";
    renderAll();
  }

  function redo() {
    if(historyIndex >= history.length-1) return toast("Nothing to redo");
    historyIndex++;
    project = clone(history[historyIndex].snap);
    selectedId = findNode(project.root,selectedId) ? selectedId : "root";
    renderAll();
  }

  function nodeLabel(node) {
    return node.name || node.type;
  }

  function getColor(type) {
    return ({
      panel:"#4d8dff",stack_panel:"#4d8dff",collection_panel:"#4d8dff",
      scrolling_panel:"#4d8dff",image:"#9b7cff",label:"#72d6a5",
      button:"#e6b85c",input_panel:"#e6b85c",toggle:"#e6b85c",custom:"#c17cff"
    })[type] || "#8fa0b7";
  }

  function renderToolbox() {
    const box = $("toolbox");
    box.innerHTML = "";
    Object.entries(TYPES).forEach(([type,t]) => {
      const b = document.createElement("button");
      b.className = "element-btn";
      b.innerHTML = `<b>${t.label}</b><span>${type}</span>`;
      b.onclick = () => addElement(type);
      box.appendChild(b);
    });
  }

  function addElement(type) {
    const parent = selected();
    const node = makeNode(type);
    node.name = uniqueName(node.name);
    parent.children = parent.children || [];
    parent.children.push(node);
    record("Add " + type);
    selectedId = node.id;
    renderAll();
    toast(`${TYPES[type].label} added`);
  }

  function uniqueName(base) {
    let name = base, n = 2;
    while(findByName(project.root,name)) name = base + "_" + n++;
    return name;
  }
  function findByName(node,name) {
    if(node.name === name) return node;
    for(const c of node.children || []) { const f=findByName(c,name); if(f)return f; }
    return null;
  }

  function deleteSelected() {
    if(selectedId === "root") return toast("Root cannot be deleted");
    const p = parentOf(selectedId);
    if(!p) return;
    const i = p.children.findIndex(x=>x.id===selectedId);
    if(i>=0) p.children.splice(i,1);
    selectedId = p.id;
    record("Delete element");
    renderAll();
  }

  function duplicateSelected() {
    const n=selected();
    if(n.id==="root") return toast("Select an element to duplicate");
    const p=parentOf(n.id); if(!p)return;
    const copy=clone(n);
    function refreshIds(x){
      x.id=uid(); x.name=uniqueName(x.name+"_copy");
      (x.children||[]).forEach(refreshIds);
    }
    refreshIds(copy);
    p.children.splice(p.children.findIndex(x=>x.id===n.id)+1,0,copy);
    selectedId=copy.id;
    record("Duplicate element");
    renderAll();
  }

  function renderTree() {
    const tree=$("tree");
    const q=($("treeSearch").value||"").toLowerCase();
    tree.innerHTML="";
    const walk=(node,depth=0)=>{
      const match=!q || nodeLabel(node).toLowerCase().includes(q) || node.type.includes(q);
      if(match){
        const row=document.createElement("div");
        row.className="tree-row"+(node.id===selectedId?" selected":"");
        row.innerHTML=`<span class="tree-indent" style="width:${depth*13}px"></span><span class="tree-caret">${node.children?.length?"▾":"·"}</span><span>${escapeHtml(nodeLabel(node))}</span><span class="tree-type">${node.type}</span>`;
        row.onclick=()=>{selectedId=node.id; renderAll();};
        tree.appendChild(row);
      }
      (node.children||[]).forEach(c=>walk(c,depth+1));
    };
    walk(project.root);
  }

  function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));}

  function anchorPoint(anchor,w,h){
    const x = anchor.includes("right") ? w : anchor.includes("center") ? w/2 : 0;
    const y = anchor.includes("bottom") ? h : anchor.includes("center") ? h/2 : 0;
    return [x,y];
  }

  function anchorXY(anchor) {
    const map = {
      top_left:[0,0],top_middle:[0.5,0],top_right:[1,0],
      middle_left:[0,0.5],center:[0.5,0.5],middle_right:[1,0.5],
      bottom_left:[0,1],bottom_middle:[0.5,1],bottom_right:[1,1]
    };
    return map[anchor]||map.top_left;
  }

  function renderCanvas() {
    const w=project.screen.width,h=project.screen.height;
    uiCanvas.style.width=w+"px"; uiCanvas.style.height=h+"px";
    canvasStage.style.transform=`scale(${zoom})`;
    uiCanvas.classList.toggle("grid-on",grid);
    uiCanvas.classList.toggle("preview-mode",preview);
    uiCanvas.innerHTML="";
    renderNode(project.root, null, 0, 0, w, h);
  }

  function renderNode(node,parentEl,parentX,parentY,parentW,parentH) {
    if(node.id==="root"){
      (node.children||[]).forEach(c=>renderNode(c,uiCanvas,0,0,project.screen.width,project.screen.height));
      return;
    }
    if(node.visible===false) return;
    const [ax,ay]=anchorXY(node.anchor_from);
    const [tx,ty]=anchorXY(node.anchor_to);
    const [ox,oy]=node.offset||[0,0];
    const [sw,sh]=node.size||[100,60];
    const x=tx*parentW - ax*sw + ox;
    const y=ty*parentH - ay*sh + oy;

    const el=document.createElement("div");
    el.className=`ui-node type-${node.type}${node.id===selectedId&&!preview?" selected":""}`;
    el.dataset.id=node.id;
    el.style.left=x+"px";el.style.top=y+"px";el.style.width=Math.max(1,sw)+"px";el.style.height=Math.max(1,sh)+"px";
    el.style.opacity=Number.isFinite(+node.alpha)?node.alpha:1;
    el.style.zIndex=node.layer||0;
    el.style.pointerEvents=preview && node.type==="label" ? "none" : "auto";

    const lab=document.createElement("div"); lab.className="node-label";
    if(node.type==="label"||node.type==="button"||node.type==="input_panel") lab.textContent=node.text||TYPES[node.type].label;
    else if(node.type==="image" && node.texture) {
      lab.textContent="";
      lab.style.backgroundImage=`url("${node.texture}")`;
      lab.style.backgroundSize="cover";
      lab.style.backgroundPosition="center";
    } else lab.textContent=preview?"":(node.name||node.type);
    el.appendChild(lab);

    el.addEventListener("pointerdown", e => startDrag(e,node));
    el.addEventListener("click",e=>{e.stopPropagation();selectedId=node.id;renderAll();});
    uiCanvas.appendChild(el);
    (node.children||[]).forEach(c=>renderNode(c,el,x,y,sw,sh));
  }

  function startDrag(e,node){
    if(preview || panMode || node.id==="root") return;
    e.stopPropagation();
    selectedId=node.id;
    const [sx,sy]=screenToUi(e.clientX,e.clientY);
    dragState={id:node.id,startX:sx,startY:sy,ox:node.offset[0],oy:node.offset[1],moved:false};
    try{e.currentTarget.setPointerCapture(e.pointerId)}catch(_){}
  }

  function screenToUi(clientX,clientY){
    const r=uiCanvas.getBoundingClientRect();
    return [(clientX-r.left)/zoom,(clientY-r.top)/zoom];
  }

  window.addEventListener("pointermove",e=>{
    if(!dragState)return;
    const [x,y]=screenToUi(e.clientX,e.clientY);
    const dx=x-dragState.startX,dy=y-dragState.startY;
    if(Math.abs(dx)+Math.abs(dy)>1)dragState.moved=true;
    const n=findNode(project.root,dragState.id); if(!n)return;
    n.offset=[Math.round(dragState.ox+dx),Math.round(dragState.oy+dy)];
    renderCanvas(); renderProperties(false); updateJsonEditor(false);
    $("coordsText").textContent=`x: ${n.offset[0]} y: ${n.offset[1]}`;
  });
  window.addEventListener("pointerup",()=>{
    if(dragState?.moved){record("Move element");renderTree();updateJsonEditor(false);}
    dragState=null;
  });

  uiCanvas.addEventListener("click",e=>{
    if(e.target===uiCanvas){selectedId="root";renderAll();}
  });

  function renderProperties(shouldRender=true) {
    const n=selected();
    if(!n || n.id==="root"){
      propsEmpty.classList.remove("hidden");props.classList.add("hidden");return;
    }
    propsEmpty.classList.add("hidden");props.classList.remove("hidden");
    props.innerHTML="";
    props.appendChild(section("Identity",[
      field("Name","text",n.name,v=>setProp(n,"name",v)),
      field("Type","text",n.type,()=>{},true)
    ]));
    props.appendChild(section("Transform",[
      twoFields("Offset",n.offset[0],n.offset[1],(a,b)=>{n.offset=[num(a),num(b)];commitIfNeeded("Offset");}),
      twoFields("Size",n.size[0],n.size[1],(a,b)=>{n.size=[num(a),num(b)];commitIfNeeded("Size");}),
      selectField("Anchor From",n.anchor_from,anchorOptions(),v=>{n.anchor_from=v;commit("Anchor");}),
      selectField("Anchor To",n.anchor_to,anchorOptions(),v=>{n.anchor_to=v;commit("Anchor");}),
      field("Layer","number",n.layer,v=>{n.layer=num(v);commit("Layer")}),
      field("Alpha","number",n.alpha,v=>{n.alpha=Math.max(0,Math.min(1,num(v)));commit("Alpha")})
    ]));
    props.appendChild(section("Display",[
      checkField("Visible",n.visible,v=>{n.visible=v;commit("Visible")}),
      checkField("Enabled",n.enabled,v=>{n.enabled=v;commit("Enabled")})
    ]));
    if(["label","button","input_panel"].includes(n.type)){
      props.appendChild(section("Text",[
        field("Text","text",n.text||"",v=>{n.text=v;commit("Text")})
      ]));
    }
    if(n.type==="image" || n.type==="button" || n.type==="panel" || n.type==="custom"){
      props.appendChild(section("Texture",[
        field("Texture path / URL","text",n.texture||"",v=>{n.texture=v;commit("Texture")}),
        htmlButton("Upload PNG","",()=> $("textureInput").click())
      ]));
    }
    props.appendChild(section("Actions",[
      htmlButton("Duplicate","",duplicateSelected),
      htmlButton("Delete","danger",deleteSelected)
    ]));
    if(shouldRender)renderCanvas();
  }

  let commitTimer=null;
  function commit(label){
    clearTimeout(commitTimer);
    commitTimer=setTimeout(()=>{record(label);renderAll();},180);
  }
  function commitIfNeeded(label){commit(label)}
  function num(v){const n=Number(v);return Number.isFinite(n)?n:0}

  function section(title,children){
    const s=document.createElement("div");s.className="property-section";
    const h=document.createElement("h3");h.textContent=title;s.appendChild(h);
    const b=document.createElement("div");b.className="property-body";children.forEach(x=>b.appendChild(x));s.appendChild(b);return s;
  }
  function field(label,type,value,onChange,disabled=false){
    const d=document.createElement("div");d.className="property";
    const l=document.createElement("label");l.textContent=label;d.appendChild(l);
    const i=document.createElement("input");i.type=type;i.value=value??"";i.disabled=disabled;
    i.addEventListener("change",()=>onChange(i.value));i.addEventListener("keydown",e=>{if(e.key==="Enter")onChange(i.value)});
    d.appendChild(i);return d;
  }
  function twoFields(label,a,b,onChange){
    const d=document.createElement("div");d.className="property";const l=document.createElement("label");l.textContent=label;d.appendChild(l);
    const row=document.createElement("div");row.className="two-col";
    const x=document.createElement("input");x.type="number";x.value=a;const y=document.createElement("input");y.type="number";y.value=b;
    x.addEventListener("change",()=>onChange(x.value,y.value));y.addEventListener("change",()=>onChange(x.value,y.value));
    row.append(x,y);d.appendChild(row);return d;
  }
  function selectField(label,value,options,onChange){
    const d=document.createElement("div");d.className="property";const l=document.createElement("label");l.textContent=label;d.appendChild(l);
    const s=document.createElement("select");options.forEach(o=>{const op=document.createElement("option");op.value=o;op.textContent=o;s.appendChild(op)});s.value=value;s.onchange=()=>onChange(s.value);d.appendChild(s);return d;
  }
  function checkField(label,value,onChange){
    const d=document.createElement("div");d.className="property";const row=document.createElement("label");row.className="check-row";
    const i=document.createElement("input");i.type="checkbox";i.checked=value;i.onchange=()=>onChange(i.checked);row.append(i,label);d.appendChild(row);return d;
  }
  function htmlButton(text,cls,fn){
    const d=document.createElement("div");d.className="property";const b=document.createElement("button");b.className="small-btn "+cls;b.style.width="100%";b.textContent=text;b.onclick=fn;d.appendChild(b);return d;
  }
  function anchorOptions(){return ["top_left","top_middle","top_right","middle_left","center","middle_right","bottom_left","bottom_middle","bottom_right"]}

  function projectToJson(){
    const root=clone(project.root);
    delete root.id;
    return {
      namespace: "jsonui_mobile_forge",
      ui_screen: {
        type: "ui_screen",
        controls: root.children || []
      }
    };
  }

  function cleanForMinecraft(node){
    const out={};
    if(node.type==="custom") out[node.name]={};
    else {
      out[node.name]={
        type:"panel",
        controls:{}
      };
    }
    return out;
  }

  function exportJsonObject(){
    // V1 exports a readable Bedrock-style control tree.
    // The project remains lossless internally via the app's own format.
    const controls={};
    (project.root.children||[]).forEach(n=>controls[n.name]=nodeToBedrock(n));
    return {
      "jsonui_mobile_forge": "V1",
      "ui_screen": {
        "namespace": "jsonui_mobile_forge",
        "controls": controls
      }
    };
  }

  function nodeToBedrock(n){
    const o={
      type: mapType(n.type),
      anchor_from:n.anchor_from,
      anchor_to:n.anchor_to,
      offset:n.offset,
      size:n.size,
      layer:n.layer,
      alpha:n.alpha,
      visible:n.visible,
      enabled:n.enabled
    };
    if(n.text) o.text=n.text;
    if(n.texture) o.texture=n.texture;
    if(n.children?.length){
      const controls={};
      n.children.forEach(c=>controls[c.name]=nodeToBedrock(c));
      o.controls=controls;
    }
    if(n.bindings?.length)o.bindings=n.bindings;
    if(Object.keys(n.variables||{}).length)o.variables=n.variables;
    return o;
  }

  function mapType(type){
    return ({
      panel:"panel",stack_panel:"stack_panel",collection_panel:"collection_panel",
      scrolling_panel:"scrolling_panel",image:"image",label:"label",button:"button",
      input_panel:"input_panel",toggle:"toggle",custom:"panel"
    })[type]||"panel";
  }

  function updateJsonEditor(force=true){
    if(force || document.activeElement!==jsonEditor){
      jsonEditor.value=JSON.stringify(exportJsonObject(),null,2);
    }
  }

  function applyJson(){
    try{
      const obj=JSON.parse(jsonEditor.value);
      const controls=obj?.ui_screen?.controls || obj?.controls || {};
      const list=Object.entries(controls).map(([name,data])=>fromBedrock(name,data));
      project.root.children=list;
      list.forEach(n=>normalizeTree(n));
      selectedId="root";record("Apply JSON");renderAll();toast("JSON applied");
      $("jsonError").style.display="none";
    }catch(e){
      $("jsonError").textContent="JSON error: "+e.message;
      $("jsonError").style.display="block";
    }
  }

  function fromBedrock(name,d){
    const type=(d?.type||"panel").toLowerCase();
    const supported=Object.keys(TYPES).includes(type)?type:(type.includes("label")?"label":type.includes("image")?"image":"panel");
    const n=makeNode(supported,name);
    n.offset=Array.isArray(d.offset)?d.offset.slice(0,2):n.offset;
    n.size=Array.isArray(d.size)?d.size.slice(0,2):n.size;
    n.anchor_from=d.anchor_from||n.anchor_from;n.anchor_to=d.anchor_to||n.anchor_to;
    n.layer=num(d.layer??0);n.alpha=num(d.alpha??1);
    n.visible=d.visible!==false;n.enabled=d.enabled!==false;
    n.text=d.text||"";n.texture=d.texture||"";
    n.bindings=d.bindings||[];n.variables=d.variables||{};
    const controls=d.controls||{};
    n.children=Object.entries(controls).map(([cn,cd])=>fromBedrock(cn,cd));
    return n;
  }

  function normalizeTree(n){
    n.id=n.id||uid();n.children=n.children||[];n.offset=n.offset||[0,0];n.size=n.size||[100,60];
    n.anchor_from=n.anchor_from||"top_left";n.anchor_to=n.anchor_to||"top_left";n.layer=n.layer??0;n.alpha=n.alpha??1;n.visible=n.visible!==false;n.enabled=n.enabled!==false;n.bindings=n.bindings||[];n.variables=n.variables||{};
    n.children.forEach(normalizeTree);
  }

  function newProject(){
    project={format_version:1,screen:{width:384,height:216},root:makeNode("panel","root")};
    project.root.id="root";selectedId="root";history=[];historyIndex=-1;record("New project");renderAll();toast("New project created");
  }

  function saveProject(){
    const data={app:"JSON UI Mobile Forge",version:1,project};
    download("project.jfproject",JSON.stringify(data,null,2),"application/json");
    toast("Project saved");
  }

  function loadProject(text){
    const data=JSON.parse(text);
    if(data.project) project=data.project;
    else if(data.root) project=data;
    normalizeTree(project.root);
    selectedId="root";record("Open project");renderAll();toast("Project loaded");
  }

  function download(name,text,type="text/plain"){
    const blob=new Blob([text],{type});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),500);
  }

  function exportJson(){
    download("jsonui_mobile_forge.json",JSON.stringify(exportJsonObject(),null,2),"application/json");
    toast("JSON exported");
  }

  function renderAll(){
    renderToolbox();renderTree();renderProperties(false);renderCanvas();updateJsonEditor(true);
    $("zoomText").textContent=Math.round(zoom*100)+"%";
  }

  function toast(msg){
    const t=$("toast");t.textContent=msg;t.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove("show"),1800);
  }

  // Tabs
  document.querySelectorAll("[data-left-tab]").forEach(b=>b.onclick=()=>{
    document.querySelectorAll("[data-left-tab]").forEach(x=>x.classList.remove("active"));b.classList.add("active");
    document.querySelectorAll("#leftPanel .tab-content").forEach(x=>x.classList.remove("active"));
    $(b.dataset.leftTab+"Tab").classList.add("active");
  });
  document.querySelectorAll("[data-right-tab]").forEach(b=>b.onclick=()=>{
    document.querySelectorAll("[data-right-tab]").forEach(x=>x.classList.remove("active"));b.classList.add("active");
    document.querySelectorAll("#rightPanel .tab-content").forEach(x=>x.classList.remove("active"));
    $(b.dataset.rightTab+"Tab").classList.add("active");
  });

  // Mobile navigation
  document.querySelectorAll(".mobile-nav button").forEach(b=>b.onclick=()=>{
    const tab=b.dataset.mobileTab;
    document.querySelectorAll(".mobile-nav button").forEach(x=>x.classList.remove("active"));b.classList.add("active");
    $("leftPanel").classList.remove("mobile-open");$("rightPanel").classList.remove("mobile-open");
    if(tab==="toolbox"||tab==="hierarchy"){
      $("leftPanel").classList.add("mobile-open");
      document.querySelector(`[data-left-tab="${tab}"]`)?.click();
    } else if(tab==="properties"||tab==="json"){
      $("rightPanel").classList.add("mobile-open");
      document.querySelector(`[data-right-tab="${tab}"]`)?.click();
    }
  });
  $("menuBtn").onclick=()=>{document.querySelector('[data-mobile-tab="toolbox"]').click()};

  $("treeSearch").oninput=renderTree;
  $("screenPreset").onchange=e=>{
    const [w,h]=e.target.value.split("x").map(Number);project.screen={width:w,height:h};renderAll();
  };
  $("zoomRange").oninput=e=>{zoom=Number(e.target.value)/100;renderCanvas();$("zoomText").textContent=e.target.value+"%"};
  $("gridBtn").onclick=()=>{grid=!grid;$("gridBtn").classList.toggle("active",grid);renderCanvas()};
  $("previewBtn").onclick=()=>{preview=!preview;$("previewBtn").classList.toggle("active",preview);renderCanvas()};
  $("selectTool").onclick=()=>{panMode=false;$("selectTool").classList.add("active");$("panTool").classList.remove("active")};
  $("panTool").onclick=()=>{panMode=true;$("panTool").classList.add("active");$("selectTool").classList.remove("active")};

  $("newBtn").onclick=newProject;
  $("exportBtn").onclick=exportJson;
  $("saveBtn").onclick=saveProject;
  $("importBtn").onclick=()=>$("fileInput").click();
  $("fileInput").onchange=async e=>{
    const f=e.target.files[0];if(!f)return;
    try{
      const text=await f.text();
      if(f.name.endsWith(".jfproject"))loadProject(text);
      else {jsonEditor.value=text;applyJson();}
    }catch(err){toast("Could not open file");console.error(err)}
    e.target.value="";
  };
  $("textureInput").onchange=async e=>{
    const f=e.target.files[0];if(!f)return;
    const n=selected();n.texture=URL.createObjectURL(f);commit("Texture upload");renderAll();toast("Texture loaded for this session");e.target.value="";
  };
  $("applyJsonBtn").onclick=applyJson;
  $("formatJsonBtn").onclick=()=>{
    try{jsonEditor.value=JSON.stringify(JSON.parse(jsonEditor.value),null,2);$("jsonError").style.display="none"}catch(e){$("jsonError").textContent=e.message;$("jsonError").style.display="block"}
  };

  // Keyboard shortcuts
  document.addEventListener("keydown",e=>{
    const mod=e.ctrlKey||e.metaKey;
    if(mod&&e.key.toLowerCase()==="z"){e.preventDefault();e.shiftKey?redo():undo();return}
    if(mod&&e.key.toLowerCase()==="y"){e.preventDefault();redo();return}
    if(mod&&e.key.toLowerCase()==="s"){e.preventDefault();saveProject();return}
    if(mod&&e.key.toLowerCase()==="d"){e.preventDefault();duplicateSelected();return}
    if(e.key==="Delete"||e.key==="Backspace"){
      if(document.activeElement.tagName!=="INPUT"&&document.activeElement.tagName!=="TEXTAREA")deleteSelected();
    }
    const n=selected();
    if(!n||n.id==="root"||document.activeElement.tagName==="INPUT"||document.activeElement.tagName==="TEXTAREA")return;
    const step=e.shiftKey?10:1;
    if(["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(e.key)){
      e.preventDefault();n.offset[0]+=e.key==="ArrowLeft"?-step:e.key==="ArrowRight"?step:0;n.offset[1]+=e.key==="ArrowUp"?-step:e.key==="ArrowDown"?step:0;record("Nudge");renderAll();
    }
  });

  // Autosave local state
  const AUTOSAVE="jsonui-mobile-forge-v1";
  setInterval(()=>{
    try{localStorage.setItem(AUTOSAVE,JSON.stringify({project,selectedId}))}catch(_){}
  },1500);

  try{
    const raw=localStorage.getItem(AUTOSAVE);
    if(raw){
      const data=JSON.parse(raw);
      if(data.project?.root){project=data.project;normalizeTree(project.root);selectedId=findNode(project.root,data.selectedId)?data.selectedId:"root";}
    }
  }catch(_){}

  record("Initial state");
  renderAll();
})();
