import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { WorkHoursStore } from './work-hours.js'
const dirs: string[]=[]
afterEach(()=>{for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true})})
function fixture(){const dir=mkdtempSync(join(tmpdir(),'shared-hours-'));dirs.push(dir);const file=join(dir,'state.json');let now=Date.parse('2026-09-16T12:00:00+07:00');return {file,store:new WorkHoursStore(file,()=>now),advance:(ms:number)=>{now+=ms},setClock:(ms:number)=>{now=ms}}}
it('shares a timer across clients and persists the result through restart',()=>{
 const f=fixture();let state=f.store.change({action:'replace-totals',expectedRevision:0,totals:{'2026-09-16':230/60}})
 state=f.store.change({action:'start',expectedRevision:state.revision});f.advance(600000)
 const other=new WorkHoursStore(f.file,()=>state.serverNow+600000)
 const stopped=other.change({action:'stop',expectedRevision:state.revision})
 expect(stopped.totals['2026-09-16']).toBe(4);expect(stopped.timer).toBeNull()
 expect(new WorkHoursStore(f.file).read().totals['2026-09-16']).toBe(4)
 expect(()=>f.store.change({action:'stop',expectedRevision:state.revision})).toThrow('máy khác')
 expect(f.store.read().totals['2026-09-16']).toBe(4)
})
it('rejects stale updates and concurrent starts without overwriting newer state',()=>{
 const f=fixture();f.store.change({action:'start',expectedRevision:0})
 expect(()=>f.store.change({action:'start',expectedRevision:0})).toThrow('máy khác')
 expect(()=>f.store.change({action:'replace-totals',expectedRevision:1,totals:{'2026-09-16':1}})).toThrow('Dừng phiên')
 expect(f.store.read().timer).not.toBeNull()
})
it('splits at Vietnam midnight and uses the server clock',()=>{
 const f=fixture();f.setClock(Date.parse('2026-09-16T23:45:00+07:00'))
 f.store.change({action:'start',expectedRevision:0,startedAt:0});f.advance(3600000)
 expect(f.store.change({action:'stop',expectedRevision:1}).totals).toEqual({'2026-09-16':.25,'2026-09-17':.75})
})
it('rejects malformed totals and preserves corrupt data rather than resetting it',()=>{
 const f=fixture();for(const totals of [{'2026-02-30':1},{'2026-09-16':25},{'2026-09-16':NaN}])expect(()=>f.store.change({action:'replace-totals',expectedRevision:0,totals})).toThrow()
 writeFileSync(f.file,'broken');expect(()=>f.store.read()).toThrow()
})
