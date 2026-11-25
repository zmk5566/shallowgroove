// A launcher may close its log reader while the desktop app is still running.
function guardLogPipe(stream){
 function onError(error){
  if(error.code!=='EPIPE'&&stream.listenerCount('error')===1)throw error;
 }
 stream.on('error',onError);
}
module.exports=function guardDesktopLogs(){
 guardLogPipe(process.stderr);
 // The one-shot FX worker also uses stdout for protocol replies.
 if(!process.argv.includes('--sg-fx-service'))guardLogPipe(process.stdout);
};
