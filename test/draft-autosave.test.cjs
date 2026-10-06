const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const source = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
function app(pathname = '/') {
  const storage = new Map(), events = {}, docEvents = {};
  const ctx = vm.createContext({URLSearchParams, console, setTimeout() {}, setInterval() {},
    location: {pathname, search: '', origin: 'https://test.invalid'},
    history: {pushState() {}, replaceState() {}},
    document: {cookie: '', getElementById() {}, querySelector() {return null;},
      createElement() {return {toDataURL() {return '';}};},
      addEventListener(k,f) {docEvents[k] = f;}},
    window: {matchMedia() {return {matches:false, addEventListener() {}};}, addEventListener(k,f) {events[k] = f;}},
    localStorage: {getItem:k=>storage.get(k)||null, setItem:(k,v)=>storage.set(k,v), removeItem:k=>storage.delete(k)}});
  // Execute the production script, substituting only initial DOM rendering and transport.
  vm.runInContext(source.replace(/\nrender\(\);\s*$/, '\n'),ctx);
  const run = code => vm.runInContext(code, ctx);
  run('render = function() {}; currentView = "report";');
  return {run, storage, events, docEvents,
    drafts() {return JSON.parse(storage.get('iggg_report_drafts') || '{}');},
    async saved() {await run(`db = {collection(){return {doc(){return {get:async()=>({exists:true,data:()=>({info:{siteName:'저장 현장',date:'2026-10-06',manager:'SSB',address:''},status:'complete'})})}}}}}; loadReportForEdit('saved-id');`);}
  };
}
test('reading a saved report and navigating back never creates an unsaved draft', async()=>{
  const a=app(); await a.saved(); a.run('autoSave(); autoSave();');
  assert.equal(a.run('hasUnsavedWork()'),false); assert.deepEqual(a.drafts(),{});
  a.events.popstate({state:{view:'home'}}); assert.deepEqual(a.drafts(),{});
});
test('immediate back saves real edits; restoring original content removes only the active draft',async()=>{
  const a=app(); await a.saved(); a.run('data.facility.notes="추가 확인";');
  a.events.popstate({state:{view:'home'}});
  assert.equal(Object.values(a.drafts())[0].data.facility.notes,'추가 확인');
  a.run('currentView="report"; data.facility.notes=""; autoSave();');
  assert.deepEqual(a.drafts(),{});
});
test('viewing another saved report does not reuse or overwrite an edited draft',async()=>{
  const a=app(); await a.saved(); a.run('data.info.siteName="수정분"; autoSave();');
  const before=a.drafts(); await a.saved(); a.run('autoSave();');
  assert.deepEqual(a.drafts(),before);
});
test('new report, deleted content, pending photo and failed save remain dirty',()=>{
  const a=app();
  assert.equal(a.run('hasUnsavedWork()'),false);
  for(const change of ['data.facility.notes="메모"','data.photos.exterior.push("data:image/png;base64,pending")']){
    a.run('data=makeInitialData();cleanReportSnapshot=reportSnapshot(data);'+change+';autoSave();');
    assert.equal(a.run('hasUnsavedWork()'),true);
  }
  a.run('cleanReportSnapshot=reportSnapshot(data);data.photos.exterior=[];');
  assert.equal(a.run('hasUnsavedWork()'),true);
});
test('canonical comparison ignores key order, missing defaults, UI flags and empty photo tags only',()=>{
  const a=app();
  assert.equal(a.run(`reportSnapshot({info:{siteName:'A',date:'B'}})===reportSnapshot({info:{date:'B',siteName:'A'}})`),true);
  assert.equal(a.run(`let x=makeInitialData();x.photos.interior=['a'];let y=JSON.parse(JSON.stringify(x));y.photos.interiorTags=[''];y.electric.panelEntries[0]._custom=true;reportSnapshot(x)===reportSnapshot(y)`),true);
  assert.equal(a.run(`y.photos.interiorTags=['주방'];reportSnapshot(x)===reportSnapshot(y)`),false);
  assert.equal(a.run(`y=JSON.parse(JSON.stringify(x));y.photos.interior=['b'];reportSnapshot(x)===reportSnapshot(y)`),false);
});
test('existing duplicate drafts are pruned only against confirmed complete saved content',()=>{
  const a=app(); a.run(`let original=makeInitialData();original.info.siteName='A';let changed=JSON.parse(JSON.stringify(original));changed.measure.area='11';
    localStorage.setItem(DRAFTS_KEY,JSON.stringify({same:{data:original,editingId:'A',ts:Date.now()},edited:{data:changed,editingId:'A',ts:Date.now()},unknown:{data:original,editingId:'B',ts:Date.now()},fresh:{data:original,ts:Date.now()}}));
    pruneUnchangedDrafts([{...original,id:'A',status:'complete'}]);`);
  assert.deepEqual(Object.keys(a.drafts()).sort(),['edited','fresh','unknown']);
});
test('guest viewing never autosaves or warns; unknown legacy draft is conservatively retained',()=>{
  const a=app('/report/shared'); a.run('data.info.siteName="shared";saving=true;autoSave();');
  assert.equal(a.run('hasUnsavedWork()'),false); assert.deepEqual(a.drafts(),{});
  const b=app(); b.run('cleanReportSnapshot=null; data.info.siteName="legacy";autoSave();');
  assert.equal(Object.keys(b.drafts()).length,1);
});
test('fully successful save stays clean; failed photo upload remains recoverable',async()=>{
  for(const failed of [false,true]){
    const a=app(); await a.saved();
    a.run(`db={collection(){return{doc(){return{update:async()=>{}}}}}};firebase={firestore:{FieldValue:{serverTimestamp(){return 0}}}};
      staffSignIn=async()=>true;showShareModal=function(){};refreshSaveBtn=function(){};
      uploadPhotoSettled=async function(src){${failed?'uploadFailed++;return src;':'return "https://test.invalid/photo.jpg";'}};
      data.photos.exterior.push('data:image/png;base64,pending');`);
    await a.run('saveReport()'); a.run('autoSave();');
    assert.equal(a.run('hasUnsavedWork()'),failed);
    assert.equal(Object.keys(a.drafts()).length,failed?1:0);
  }
});
