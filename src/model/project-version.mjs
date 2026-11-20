import manifest from '../../package.json' with {type:'json'};
export const appVersion=manifest.version;

// Core versions compare numerically. Prereleases precede the release, and build labels do not affect precedence.
function parts(value){
 const match=typeof value==='string'&&value.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/);
 if(!match)throw Error('Invalid project application version');
 const pre=match[4]?.split('.');
 if(pre?.some(s=>/^0\d+$/.test(s)))throw Error('Invalid project application version');
 return {core:match.slice(1,4).map(BigInt),pre};
}
export function compareVersions(left,right){
 const a=parts(left),b=parts(right);
 for(let i=0;i<3;i++)if(a.core[i]!==b.core[i])return a.core[i]<b.core[i]?-1:1;
 if(!a.pre||!b.pre)return a.pre?-1:b.pre?1:0;
 for(let i=0;i<Math.min(a.pre.length,b.pre.length);i++){
  const x=a.pre[i],y=b.pre[i];if(x===y)continue;
  const xn=/^\d+$/.test(x),yn=/^\d+$/.test(y);
  if(xn&&yn)return BigInt(x)<BigInt(y)?-1:1;
  if(xn!==yn)return xn?-1:1;
  return x<y?-1:1;
 }
 return Math.sign(a.pre.length-b.pre.length);
}
export function checkProjectVersion(file){
 if(file?.format!=='shallowgroove-project')throw Error('Unsupported project format');
 if(file.minAppVersion!==undefined&&compareVersions(appVersion,file.minAppVersion)<0)
  throw Error(`此工程需要 ShallowGroove ${file.minAppVersion} 或更高版本（当前 ${appVersion}）。 Requires ShallowGroove ${file.minAppVersion} or later.`);
 if(file.version!==1)throw Error('Unsupported project format');
}
