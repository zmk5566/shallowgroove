// Only supported locale values cross the renderer/main-process boundary.
exports.createConnectLocale=()=>{
 let locale;
 async function apply(window){
  if(!locale||!window||window.isDestroyed()||window.webContents.isLoadingMainFrame?.())return;
  await window.webContents.executeJavaScript(`import('/i18n.js').then(i18n=>i18n.setLocale(${JSON.stringify(locale)}))`);
 }
 return {
  async set(next,window){
   if(next!=='zh-CN'&&next!=='en')return false;
   locale=next;await apply(window);return true;
  },
  apply,
  url(origin){const url=new URL(origin);if(locale)url.searchParams.set('locale',locale);return url.href;},
 };
};
