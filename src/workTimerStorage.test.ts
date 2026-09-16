import { afterEach, expect, it, vi } from 'vitest'
import { api } from './api'
import { attachWorkTimerStorage, WORK_TIMER_CHANNEL } from './workTimerStorage'
vi.mock('./api',()=>({api:{workHours:vi.fn(),session:vi.fn(),changeWorkHours:vi.fn()}}))
afterEach(()=>{vi.unstubAllGlobals();vi.resetAllMocks()})
function fixture(){let listener:(event:MessageEvent)=>Promise<void>=async()=>{};vi.stubGlobal('window',{addEventListener:(_:string,fn:typeof listener)=>{listener=fn},removeEventListener:vi.fn()});const child={postMessage:vi.fn()} as unknown as Window;attachWorkTimerStorage(()=>child);return{child,send:(body:object,source=child,origin='null')=>listener({source,origin,data:{channel:WORK_TIMER_CHANNEL,id:'1',...body}} as MessageEvent)}}
it('reads shared server data and uses authenticated versioned commands',async()=>{
 const f=fixture(),state={revision:3,totals:{'2026-09-16':230/60},timer:null,serverNow:1000};vi.mocked(api.workHours).mockResolvedValue(state);vi.mocked(api.session).mockResolvedValue({csrf:'csrf'} as never);vi.mocked(api.changeWorkHours).mockResolvedValue({...state,revision:4});await f.send({action:'get'});expect(f.child.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({shared:true,revision:3}),'*');await f.send({action:'command',command:'start',expectedRevision:3});expect(api.changeWorkHours).toHaveBeenCalledWith({action:'start',expectedRevision:3},'csrf')
})
it('rejects other windows, origins, arbitrary storage writes and unsupported actions',async()=>{
 const f=fixture();await f.send({action:'get'},{} as Window);await f.send({action:'get'},f.child,'https://attacker.test');expect(api.workHours).not.toHaveBeenCalled();await f.send({action:'set',key:'secret',value:'x'});expect(api.changeWorkHours).not.toHaveBeenCalled();expect(f.child.postMessage).toHaveBeenCalledWith(expect.objectContaining({error:expect.any(String)}),'*')
})
