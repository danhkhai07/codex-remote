import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorkingHoursPage, isWorkingHoursPath } from './WorkingHoursPage'
it('routes only the working-hours entry paths',()=>{
 expect(isWorkingHoursPath('/working-hours')).toBe(true)
 expect(isWorkingHoursPath('/working-hours/')).toBe(true)
 for(const path of ['/','/workboard','/working-hours-other','/working-hours/files'])expect(isWorkingHoursPath(path)).toBe(false)
})
it('does not mount the private dashboard before checking the session',()=>{
 const html=renderToStaticMarkup(<WorkingHoursPage />)
 expect(html).toContain('Đang mở giờ làm việc')
 expect(html).not.toContain('iframe')
 expect(html).not.toContain('/root/VAULTS')
})
