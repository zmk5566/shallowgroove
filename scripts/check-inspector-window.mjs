import {_electron,chromium,expect} from '@playwright/test';
import {mkdtemp} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';

const target=process.argv[2];
const desktop=target&&!target.startsWith('http');
const app=desktop?await _electron.launch({
 executablePath:resolve(target,'Contents/MacOS/ShallowGroove'),
 args:['--user-data-dir='+await mkdtemp(join(tmpdir(),'sg-inspector-'))],
}):await chromium.launch({channel:'chrome'});
try{
 const main=desktop?await app.firstWindow():await app.newPage({viewport:{width:1440,height:900}});
 if(!desktop)await main.goto(target??'http://127.0.0.1:5173');
 await main.locator('[data-example="DaisyBell"]').click();
 const inspect=main.locator('.channel-inspect').first(),picker=main.locator('.inspect-picker');
 await expect(inspect).toBeEnabled({timeout:90000});
 await inspect.click();
 await expect(picker.getByRole('checkbox')).toHaveCount(3);
 for(const toggle of await picker.getByRole('checkbox').all())await expect(toggle).toBeChecked();
 await picker.locator('.primary').click();
 const cards=main.locator('.inspect-card');
 await expect(cards).toHaveCount(3);
 const wave=await main.locator('.inspect-card.wave').boundingBox(),spectrum=await main.locator('.inspect-card.spectrum').boundingBox(),gram=await main.locator('.inspect-card.spectrogram').boundingBox();
 expect(wave.y).toBe(spectrum.y);expect(gram.width).toBeGreaterThan(wave.width*1.9);
 await inspect.click();await picker.locator('.primary').click();await expect(cards).toHaveCount(3);
 await cards.first().getByRole('button').click();await expect(cards).toHaveCount(2);
 const fold=main.locator('.inspect-section >button');await fold.click();await expect(cards).toHaveCount(0);
 await fold.click();await expect(cards).toHaveCount(2);
 const draft=main.locator('.assistant-composer textarea');await draft.fill('draft');
 const chat=main.locator('.sidebar-chat'),chatFold=main.locator('.chat-fold');
 await chatFold.click();await expect(draft).toBeHidden();
 await chatFold.click();await expect(draft).toHaveValue('draft');
 const divider=main.locator('.chat-divider');const before=(await chat.boundingBox()).height;
 const rect=await divider.boundingBox();await main.mouse.move(rect.x+10,rect.y+rect.height/2);
 await main.mouse.down();await main.mouse.move(rect.x+10,rect.y+rect.height/2+45);await main.mouse.up();
 expect((await chat.boundingBox()).height).toBeLessThan(before-35);
 const device=main.locator('.device-panel button').filter({hasText:/^(Inspect|检查)$/});
 await device.click();await expect(picker.getByRole('checkbox')).toHaveCount(4);
 await picker.getByRole('checkbox').last().check();
 const opened=desktop?app.waitForEvent('window'):main.waitForEvent('popup');
 await picker.getByRole('button',{name:/独立窗口|Separate window/}).click();
 const child=await opened;
 await expect(child.locator('canvas:visible')).toHaveCount(3);
 await expect(child.locator('output')).toContainText('%',{timeout:20000});await child.close();
 console.log('PASS: inspector selection, tile layout, removal, folding, chat draft and resize, separate DSP window');
}finally{await app.close();}
