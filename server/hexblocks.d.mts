import type {Plugin} from 'vite';
import type {Server} from 'node:http';
export function hexblocksPlugin(env?:Record<string,string|undefined>):Plugin;
export function attachHexblocks(server:Server,env?:Record<string,string|undefined>):{token:string;close:()=>void};
export function trustedLocalPeer(address:string|undefined,host:string|undefined,origin:string|undefined):boolean;
