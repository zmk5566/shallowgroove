// Factory presets use parameter labels. Saved patches use the full Faust address.
export function libraryParameters(
 controls:ReadonlyArray<{address:string;label:string;min:number;max:number}>,
 values:Readonly<Record<string,number>>
){
 const result:Record<string,number>={};
 for(const c of controls){
  const value=Object.hasOwn(values,c.address)?values[c.address]:values[c.label];
  if(Number.isFinite(value))result[c.address]=Math.max(c.min,Math.min(c.max,value));
 }
 return result;
}
