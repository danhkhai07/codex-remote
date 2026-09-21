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

it('continues automatic activity after entering, increasing, decreasing, and zeroing hours', () => {
 const f = fixture(), day = '2026-09-16'
 const estimate = (hours: number) => writeFileSync(join(f.file, '..', 'data.json'), JSON.stringify({days: [{date: day, estimatedHours: hours}]}))
 estimate(2)
 f.store.change({action: 'replace-totals', expectedRevision: 0, totals: {[day]: 4}})
 estimate(3)
 expect(f.store.read().totals[day]).toBe(5)
 f.store.change({action: 'replace-totals', expectedRevision: 1, totals: {[day]: 1}})
 estimate(3.5)
 expect(f.store.read().totals[day]).toBe(1.5)
 f.store.change({action: 'replace-totals', expectedRevision: 2, totals: {[day]: 0}})
 estimate(4)
 expect(new WorkHoursStore(f.file).read().totals[day]).toBe(.5)
})
it('resumes estimates after a timer without counting its estimated activity twice', () => {
 const f = fixture(), day = '2026-09-16'
 const estimate = (hours: number) => writeFileSync(join(f.file, '..', 'data.json'), JSON.stringify({days: [{date: day, estimatedHours: hours}]}))
 estimate(2)
 f.store.change({action: 'start', expectedRevision: 0})
 f.advance(3600000); estimate(3)
 expect(f.store.change({action: 'stop', expectedRevision: 1}).totals[day]).toBe(3)
 estimate(3.5)
 expect(f.store.read().totals[day]).toBe(3.5)
})
it('preserves legacy totals and enables further automatic activity on first read', () => {
 const f = fixture(), day = '2026-09-16', dataFile = join(f.file, '..', 'data.json')
 writeFileSync(f.file, JSON.stringify({revision: 4, totals: {[day]: 6}, timer: null}))
 writeFileSync(dataFile, JSON.stringify({days: [{date: day, estimatedHours: 2}]}))
 expect(f.store.read().totals[day]).toBe(6)
 writeFileSync(dataFile, JSON.stringify({days: [{date: day, estimatedHours: 3}]}))
 expect(f.store.read().totals[day]).toBe(7)
})

it('freezes globally through new estimates and restart, then counts only post-resume intervals', () => {
 const f = fixture(), day = '2026-09-16', at = (hour: number) => Date.parse(`${day}T00:00:00+07:00`) + hour * 3600000
 const estimates = (intervals: number[][]) => writeFileSync(join(f.file, '..', 'data.json'), JSON.stringify({days: [], activityIntervals: intervals}))
 estimates([[at(10), at(12)]])
 expect(f.store.read().totals[day]).toBe(2)
 f.store.change({action: 'pause', expectedRevision: 0})
 estimates([[at(9), at(14)]]) // delayed pre-pause logs and activity inside pause
 f.advance(2 * 3600000)
 const other = new WorkHoursStore(f.file, () => at(14))
 expect(other.read()).toMatchObject({autoPaused: true, totals: {[day]: 2}, timer: null})
 other.change({action: 'resume', expectedRevision: 1})
 expect(other.read().totals[day]).toBe(2)
 estimates([[at(9), at(15)]]) // an interval bridging both edges of pause
 expect(other.read().totals[day]).toBe(3)
 expect(other.read().timer).toBeNull()
 other.change({action: 'replace-totals', expectedRevision: 2, totals: {[day]: 4}})
 estimates([[at(9), at(16)]])
 expect(other.read().totals[day]).toBe(5)
})
it('stops a manual timer at pause, preserves edits while paused and rejects stale toggles', () => {
 const f = fixture(), day = '2026-09-16'
 f.store.change({action: 'replace-totals', expectedRevision: 0, totals: {[day]: 3}})
 f.store.change({action: 'start', expectedRevision: 1}); f.advance(3600000)
 expect(f.store.change({action: 'pause', expectedRevision: 2})).toMatchObject({totals: {[day]: 4}, timer: null, autoPaused: true})
 expect(() => f.store.change({action: 'resume', expectedRevision: 2})).toThrow('máy khác')
 expect(() => f.store.change({action: 'start', expectedRevision: 3})).toThrow('Tiếp tục')
 expect(() => f.store.change({action: 'pause', expectedRevision: 3})).toThrow('đã tạm dừng')
 expect(f.store.change({action: 'replace-totals', expectedRevision: 3, totals: {[day]: 1}})).toMatchObject({autoPaused: true, totals: {[day]: 1}})
 f.advance(3600000)
 expect(f.store.change({action: 'resume', expectedRevision: 4})).toMatchObject({autoPaused: false, totals: {[day]: 1}, timer: null})
 expect(() => f.store.change({action: 'resume', expectedRevision: 5})).toThrow('đang hoạt động')
})
it('excludes paused days and delayed midnight overlap over repeated pause windows', () => {
 const f = fixture(), start = Date.parse('2026-09-16T23:30:00+07:00'), dataFile = join(f.file, '..', 'data.json')
 const estimates = (end: number) => writeFileSync(dataFile, JSON.stringify({days: [], activityIntervals: [[start, end]]}))
 f.setClock(start + 15 * 60000); estimates(start + 15 * 60000)
 f.store.change({action: 'pause', expectedRevision: 0})
 f.advance(3600000); estimates(start + 75 * 60000)
 expect(f.store.read().totals).toEqual({'2026-09-16': .25})
 f.store.change({action: 'resume', expectedRevision: 1})
 estimates(start + 105 * 60000); f.advance(30 * 60000)
 expect(f.store.read().totals).toEqual({'2026-09-16': .25, '2026-09-17': .5})
 f.store.change({action: 'pause', expectedRevision: 2}); f.advance(3600000)
 estimates(start + 165 * 60000); f.store.change({action: 'resume', expectedRevision: 3})
 estimates(start + 195 * 60000)
 expect(f.store.read().totals).toEqual({'2026-09-16': .25, '2026-09-17': 1})
 expect(f.store.read().pauseWindows).toHaveLength(2)
})
it('migrates without pausing and ignores old generator counters after explicit resume', () => {
 const f = fixture(), day = '2026-09-16', dataFile = join(f.file, '..', 'data.json')
 writeFileSync(f.file, JSON.stringify({revision: 7, totals: {[day]: 6}, timer: null}))
 writeFileSync(dataFile, JSON.stringify({days: [{date: day, estimatedHours: 2}]}))
 expect(f.store.read()).toMatchObject({revision: 7, autoPaused: false, totals: {[day]: 6}})
 f.store.change({action: 'pause', expectedRevision: 7}); f.advance(3600000)
 f.store.change({action: 'resume', expectedRevision: 8})
 writeFileSync(dataFile, JSON.stringify({days: [{date: day, estimatedHours: 4}]}))
 expect(f.store.read().totals[day]).toBe(6)
})
