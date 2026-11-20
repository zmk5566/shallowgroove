// React may detach and immediately reattach effects during Fast Refresh.
// Dispose the current engine only when its owner actually stays detached.
const owners=new WeakMap<object,object>();
export function retainEngine<T extends {dispose():Promise<void>}>(ref:{current:T}){
 const owner={};
 owners.set(ref,owner);
 return ()=>queueMicrotask(()=>{
  if(owners.get(ref)!==owner)return;
  owners.delete(ref);
  void ref.current.dispose();
 });
}
