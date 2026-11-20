/** Read a Faust name declaration without mistaking comments or UI strings for metadata. */
export function declaredPatchName(code:string):string|undefined{
 const tokens=code.match(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\/|[A-Za-z_][A-Za-z_0-9]*|[^\s]/g)?.filter(t=>!t.startsWith('//')&&!t.startsWith('/*'))??[];
 for(let i=0;i<tokens.length-3;i++)if(tokens[i]==='declare'&&tokens[i+1]==='name'&&tokens[i+2].startsWith('"')&&tokens[i+3]===';'){
  const name=tokens[i+2].slice(1,-1).replace(/\\(["\\])/g,'$1').replace(/[\u0000-\u001f\u007f]/g,' ').trim();if(name)return name.slice(0,120);
 }
 return undefined;
}
export function instrumentName(code:string,initialCode:string,initialName:string,customFallback:string){return code===initialCode?initialName:declaredPatchName(code)??customFallback;}
