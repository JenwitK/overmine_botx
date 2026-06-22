
const mineflayer = require('mineflayer');
const express = require('express');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const fs = require('fs');
const path = require('path');

let SERVER_HOST = 'play.overmine.online';
let SERVER_VERSION = '1.21.11';
let AUTO_RECONNECT = true;
let RECONNECT_DELAY = 10000;
let QUEUE_DELAY = 2000;
let MAX_RECONNECT_ATTEMPTS = 5;
let SPOOF_IP = false;
let LOW_RAM_MODE = false;
const WEB_PORT = process.env.PORT || 3000;

const accountList = [
  {
    name: 'Bot_AFK_01',
    password: '161263',
    pin: [15, 26, 15, 16, 26, 17],
    targetServer: 'classic',  
  },
  {
    name: 'BasToAFK',
    password: '161263',
    pin: [15, 26, 15, 16, 26, 17],
    targetServer: 'classic',  
  },
];

const ACCOUNTS_FILE = path.join(__dirname, 'accounts.json');

function loadAccountsFromFile() {
  try {
    if (fs.existsSync(ACCOUNTS_FILE)) {
      const data = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8'));
      if (Array.isArray(data) && data.length > 0) {
        accountList.length = 0;
        data.forEach(a => accountList.push(a));
        console.log('[SYSTEM] โหลดบัญชีจาก accounts.json (' + data.length + ' บัญชี)');
      }
    } else {
      saveAccountsToFile();
    }
  } catch (err) {
    console.log('[SYSTEM] ไม่สามารถโหลด accounts.json: ' + err.message);
  }
}

function saveAccountsToFile() {
  try {
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accountList, null, 2), 'utf-8');
  } catch (err) {
    console.log('[SYSTEM] ไม่สามารถบันทึก accounts.json: ' + err.message);
  }
}

loadAccountsFromFile();

const botStatusList = [];   
const botInstances = [];    
let isRunning = false;

const logBuffer = [];
const MAX_LOG_ENTRIES = 200;

const STATUS = {
  IDLE: 'idle',
  CONNECTING: 'connecting',
  LIMBO_AUTH: 'limbo_auth',
  PIN_ENTRY: 'pin_entry',
  LOBBY: 'lobby',
  SEARCHING_ENTITY: 'searching_entity',
  ENTERING_SMP: 'entering_smp',
  AFK_ACTIVE: 'afk_active',
  KICKED: 'kicked',
  ERROR: 'error',
  RECONNECTING: 'reconnecting',
  BANNED: 'banned',
  MANUAL_STOP: 'manual_stop',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function timestamp() {
  return new Date().toLocaleTimeString('th-TH', { hour12: false });
}

function log(botName, message) {
  const entry = `[${timestamp()}] [${botName}] ${message}`;
  console.log(entry);

  logBuffer.push({ time: timestamp(), bot: botName, message, raw: entry });
  if (logBuffer.length > MAX_LOG_ENTRIES) {
    logBuffer.splice(0, logBuffer.length - MAX_LOG_ENTRIES);
  }
}

function updateStatus(index, status, statusCode) {
  if (botStatusList[index]) {
    botStatusList[index].status = status;
    botStatusList[index].statusCode = statusCode;
  }
}

async function createBot(accountConfig, index) {
  updateStatus(index, 'กำลังเชื่อมต่อ...', STATUS.CONNECTING);
  log(accountConfig.name, 'กำลังเชื่อมต่อไปยัง ' + SERVER_HOST);

  const botOptions = {
    host: SERVER_HOST,
    version: SERVER_VERSION,
    username: accountConfig.name,
    auth: 'offline',
    hideErrors: true,
    checkTimeoutInterval: 60000,
    keepAlive: true,
    respawn: accountConfig.autoRespawn !== false,
  };

  if (typeof LOW_RAM_MODE !== 'undefined' && LOW_RAM_MODE) {
    botOptions.viewDistance = 'tiny';
  }

  if (SPOOF_IP) {
    const randomIP = `${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
    const randomUUID = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
    botOptions.fakeHost = `${SERVER_HOST}\0${randomIP}\0${randomUUID}`;
    log(accountConfig.name, `[Spoof IP] สร้างไอพีปลอม: ${randomIP}`);
  }

  const bot = mineflayer.createBot(botOptions);

  botInstances[index] = bot;
  let hasEnteredSMP = false;
  let pinCompleted = false;
  let authDone = false;

  bot.once('spawn', () => {
    bot.loadPlugin(pathfinder);
    log(accountConfig.name, 'Pathfinder plugin loaded');
    
    setTimeout(async () => {
      if (!authDone) {
        log(accountConfig.name, 'ไม่พบข้อความแจ้งเตือนจากเซิร์ฟเวอร์ — พยายาม Login/Register อัตโนมัติ...');
        authDone = true;
        
        bot.chat('/login ' + accountConfig.password);
        await sleep(1000);
        
        if (SERVER_HOST.toLowerCase().includes('amory')) {
          let email = (typeof accountConfig.pin === 'string' && accountConfig.pin.includes('@')) ? accountConfig.pin.trim() : 'test@gmail.com';
          bot.chat('/register ' + accountConfig.password + ' ' + email);
          setTimeout(() => enterSMP(), 3000);
        } else {
          bot.chat('/register ' + accountConfig.password + ' ' + accountConfig.password);
        }
      }
    }, 4000);
  });

  bot.on('title', (text) => {
    try {
      const parsed = typeof text === 'string' ? text : (text.text || JSON.stringify(text));
      log(accountConfig.name, `[TITLE] ${parsed}`);
    } catch(e) {}
  });

  bot.on('actionBar', (text) => {
    try {
      const parsed = typeof text === 'string' ? text : (text.text || JSON.stringify(text));
      log(accountConfig.name, `[ACTIONBAR] ${parsed}`);
    } catch(e) {}
  });

  bot.on('bookOpen', () => {
    log(accountConfig.name, `[BOOK] Server opened a book!`);
  });

  bot.on('messagestr', async (message) => {
    const msg = message.toLowerCase();

    if (!authDone && (msg.includes('สมัครสมาชิก') || msg.includes('/reg') || msg.includes('/register'))) {
      authDone = true;
      updateStatus(index, 'Limbo — กำลังสมัครสมาชิก...', STATUS.LIMBO_AUTH);
      log(accountConfig.name, 'เซิร์ฟเวอร์ขอ Register — ส่งคำสั่ง /register');

      await sleep(500);
      if (SERVER_HOST.toLowerCase().includes('amory')) {
        let email = (typeof accountConfig.pin === 'string' && accountConfig.pin.includes('@')) ? accountConfig.pin.trim() : 'test@gmail.com';
        bot.chat('/register ' + accountConfig.password + ' ' + email);
      } else {
        bot.chat('/register ' + accountConfig.password + ' ' + accountConfig.password);
      }
      log(accountConfig.name, 'ส่งคำสั่ง /register แล้ว');
    }

    if (!authDone && (msg.includes('เข้าสู่ระบบ') || msg.includes('/login') || msg.includes('/l '))) {
      authDone = true;
      updateStatus(index, 'Limbo — กำลังเข้าสู่ระบบ...', STATUS.LIMBO_AUTH);
      log(accountConfig.name, 'เซิร์ฟเวอร์ขอ Login — ส่งคำสั่ง /login');

      await sleep(500);
      bot.chat('/login ' + accountConfig.password);
      log(accountConfig.name, 'ส่งคำสั่ง /login แล้ว');
    }

    if (!hasEnteredSMP && (msg.includes('สมัครสมาชิกสำเร็จ') || msg.includes('เข้าสู่ระบบสำเร็จ') || msg.includes('ยินดีต้อนรับ'))) {
      updateStatus(index, 'ยืนยันตัวตนสำเร็จ — รอเข้า Lobby', STATUS.LOBBY);
      log(accountConfig.name, 'ยืนยันตัวตนสำเร็จ!');
      
      if (SERVER_HOST.toLowerCase().includes('amory')) {
        setTimeout(() => enterSMP(), 3000);
      }
    }
  });

  bot.on('windowOpen', async (window) => {
    const title = typeof window.title === 'string'
      ? window.title
      : JSON.stringify(window.title);

    log(accountConfig.name, `หน้าต่างเปิด: ${title} (slots: ${window.slots.length})`);

    const isOvermine = SERVER_HOST.toLowerCase().includes('overmine');
    const isPinWindow = isOvermine && ((title && title.toUpperCase().includes('PIN')) || window.slots.length > 54);

    if (isPinWindow && !pinCompleted) {
      updateStatus(index, 'กำลังกรอก PIN...', STATUS.PIN_ENTRY);
      log(accountConfig.name, 'ตรวจพบหน้าต่าง PIN — เริ่มกรอกรหัส PIN');

      try {
        for (let i = 0; i < accountConfig.pin.length; i++) {
          if (!bot.currentWindow) {
            log(accountConfig.name, 'หน้าต่างถูกปิดระหว่างกรอก PIN — เซิร์ฟเวอร์ยอมรับ PIN แล้ว');
            pinCompleted = true;
            updateStatus(index, 'กรอก PIN สำเร็จ! กำลังเข้า Lobby...', STATUS.LOBBY);

            enterSMP();
            return;
          }

          const slot = accountConfig.pin[i];
          log(accountConfig.name, `กด PIN slot ${slot} (${i + 1}/${accountConfig.pin.length})`);
          bot.clickWindow(slot, 0, 0);

          await sleep(800);
        }

        pinCompleted = true;
        updateStatus(index, 'กรอก PIN สำเร็จ!', STATUS.LOBBY);
        log(accountConfig.name, 'กรอก PIN สำเร็จ!');

        enterSMP();
      } catch (err) {
        log(accountConfig.name, 'ข้อผิดพลาดกรอก PIN: ' + err.message);
        updateStatus(index, 'ข้อผิดพลาด PIN: ' + err.message, STATUS.ERROR);
      }
    }
  });

  async function enterSMP() {
    if (!botInstances[index]) return; // Stop if bot was disconnected
    if (hasEnteredSMP) return;
    hasEnteredSMP = true;

    try {
      bot.setQuickBarSlot(2);
      log(accountConfig.name, 'เปลี่ยนถือของไปช่องที่ 3');
    } catch (err) {}

    const targetServerName = (accountConfig.targetServer || 'classic').toLowerCase();

    if (SERVER_HOST.toLowerCase().includes('amory')) {
      updateStatus(index, `อยู่ใน Lobby — กำลังเตรียมเข้า SMP...`, STATUS.SEARCHING_ENTITY);
      log(accountConfig.name, `เริ่ม Phase 3 (AmoryCraft) — รอ 3 วินาที`);
      
      try {
        await sleep(3000);
        bot.setQuickBarSlot(0);
        log(accountConfig.name, 'เลือก Slot แรกสุดแล้ว');
        
        await sleep(1000);
        let windowOpened = false;
        
        bot.once('windowOpen', async (window) => {
          windowOpened = true;
          log(accountConfig.name, `[AmoryCraft] หน้าต่าง GUI เปิดแล้ว — กำลังกดคลิก Slot ที่ 10`);
          await sleep(1000);
          try {
            bot.clickWindow(10, 0, 0);
            updateStatus(index, `[OK] AFK อยู่ในเซิร์ฟเวอร์!`, STATUS.AFK_ACTIVE);
            log(accountConfig.name, `[OK] กดเข้า SMP สำเร็จแล้ว — กำลัง AFK`);
            if (typeof LOW_RAM_MODE !== 'undefined' && LOW_RAM_MODE) {
              log(accountConfig.name, `[Low RAM Mode] พักการทำงานระบบ Physics เพื่อประหยัด CPU/RAM`);
              bot.physicsEnabled = false;
            }
          } catch(err) {
            log(accountConfig.name, `ข้อผิดพลาดกดคลิก Slot: ` + err.message);
          }
        });

        bot.activateItem();
        log(accountConfig.name, 'กดคลิกขวาใช้งานไอเทมในมือ (เข็มทิศ)');
        
        setTimeout(() => {
          if (!windowOpened) log(accountConfig.name, '[WARN] หน้าต่าง GUI ไม่เปิดขึ้นมาหลังคลิกขวา');
        }, 5000);

        setTimeout(() => {
          if (bot && botStatusList[index]) {
            botStatusList[index].checkingMoney = true;
            bot.chat('/money');
            setTimeout(() => {
              if (botStatusList[index]) botStatusList[index].checkingMoney = false;
            }, 5000);
          }
        }, 15000);
      } catch (e) {
        log(accountConfig.name, 'ข้อผิดพลาด: ' + e.message);
      }
      return;
    }

    updateStatus(index, `อยู่ใน Lobby — กำลังค้นหา Allay (${targetServerName})...`, STATUS.SEARCHING_ENTITY);
    log(accountConfig.name, `เริ่ม Phase 3 — รอโหลด chunks/entities (5 วินาที)`);

    try {
      if (typeof LOW_RAM_MODE !== 'undefined' && LOW_RAM_MODE) {
        bot.physicsEnabled = true;
      }
      await sleep(5000);

      const allAllays = [];
      for (const id of Object.keys(bot.entities)) {
        const entity = bot.entities[id];
        if (entity.name && entity.name.toLowerCase() === 'allay') {
          allAllays.push(entity);
        }
      }

      log(accountConfig.name, `พบ Allay ทั้งหมด ${allAllays.length} ตัว`);
      allAllays.forEach((a, i) => {
        const displayName = a.displayName || a.username || a.name;
        log(accountConfig.name, `  Allay #${i}: pos=(${a.position.x.toFixed(1)}, ${a.position.y.toFixed(1)}, ${a.position.z.toFixed(1)}) name=${displayName}`);
      });

      if (allAllays.length === 0) {
        log(accountConfig.name, '[WARN] ไม่พบ Allay — ลองใหม่ใน 5 วินาที...');
        updateStatus(index, '[WARN] ไม่พบ Allay — กำลังลองใหม่...', STATUS.SEARCHING_ENTITY);
        hasEnteredSMP = false;
        await sleep(5000);

        for (const id of Object.keys(bot.entities)) {
          const entity = bot.entities[id];
          if (entity.name && entity.name.toLowerCase() === 'allay') {
            allAllays.push(entity);
          }
        }

        if (allAllays.length === 0) {
          updateStatus(index, '[ERROR] ไม่พบ Allay ใน Lobby', STATUS.ERROR);
          log(accountConfig.name, '[ERROR] ไม่พบ Allay แม้จะลองใหม่แล้ว');
          return;
        }
        hasEnteredSMP = true;
      }

      allAllays.sort((a, b) => {
        return bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position);
      });

      let targetAllay = allAllays.find((a) => {
        const name = (a.displayName || a.username || '').toLowerCase();
        return name.includes(targetServerName);
      });

      if (!targetAllay) {
        targetAllay = allAllays[0];
        log(accountConfig.name, `ไม่สามารถระบุ Allay ตามชื่อ "${targetServerName}" ได้ — ใช้ตัวที่ใกล้ที่สุด`);
      }

      const dist = bot.entity.position.distanceTo(targetAllay.position);
      updateStatus(index, `พบ Allay! กำลังเดินไป... (${dist.toFixed(1)} บล็อก)`, STATUS.ENTERING_SMP);
      log(accountConfig.name, `เป้าหมาย Allay ที่ตำแหน่ง (${targetAllay.position.x.toFixed(1)}, ${targetAllay.position.y.toFixed(1)}, ${targetAllay.position.z.toFixed(1)}) — ระยะ ${dist.toFixed(1)} บล็อก`);

      try {
        const mcData = require('minecraft-data')(bot.version);
        const movements = new Movements(bot, mcData);
        movements.canDig = false;
        movements.allow1by1towers = false;
        movements.scafoldingBlocks = [];
        bot.pathfinder.setMovements(movements);

        const goal = new goals.GoalNear(targetAllay.position.x, targetAllay.position.y, targetAllay.position.z, 2);
        log(accountConfig.name, 'เริ่มเดินไปหา Allay ด้วย Pathfinder...');

        await bot.pathfinder.goto(goal);
        log(accountConfig.name, 'เดินถึง Allay แล้ว!');
      } catch (pathErr) {
        log(accountConfig.name, `Pathfinder error: ${pathErr.message} — ลองเดินตรงไป`);
        await bot.lookAt(targetAllay.position.offset(0, targetAllay.height / 2, 0));
        bot.setControlState('forward', true);
        await sleep(3000);
        bot.setControlState('forward', false);
      }

      await sleep(500);
      await bot.lookAt(targetAllay.position.offset(0, targetAllay.height / 2, 0));
      log(accountConfig.name, 'มองไปที่ Allay แล้ว');

      await sleep(1000);

      await bot.activateEntity(targetAllay);
      log(accountConfig.name, 'คลิกขวา Allay — กำลังเข้า SMP!');

      updateStatus(index, `[OK] AFK อยู่ใน ${targetServerName.toUpperCase()}!`, STATUS.AFK_ACTIVE);
      botStatusList[index].reconnectAttempts = 0;
      log(accountConfig.name, `[OK] เข้า ${targetServerName.toUpperCase()} สำเร็จ — กำลัง AFK`);

      if (typeof LOW_RAM_MODE !== 'undefined' && LOW_RAM_MODE) {
        log(accountConfig.name, `[Low RAM Mode] พักการทำงานระบบ Physics เพื่อประหยัด CPU/RAM`);
        bot.physicsEnabled = false;
      }

      setTimeout(() => {
        if (bot) {
          botStatusList[index].checkingMoney = true;
          bot.chat('/money');

          setTimeout(() => {
            if (botStatusList[index]) botStatusList[index].checkingMoney = false;
          }, 5000);
        }
      }, 5000); 

    } catch (err) {
      log(accountConfig.name, 'ข้อผิดพลาดค้นหา/เดินไป Entity: ' + err.message);
      updateStatus(index, 'ข้อผิดพลาด: ' + err.message, STATUS.ERROR);
      hasEnteredSMP = false;
    }
  }

  bot.on('windowClose', () => {
    if (pinCompleted && !hasEnteredSMP) {
      log(accountConfig.name, 'windowClose detected — triggering enterSMP...');
      enterSMP();
    }
  });

  bot.on('kicked', (reason) => {
    let reasonText;
    try {
      const parsed = JSON.parse(reason);
      reasonText = parsed.text || parsed.extra?.map((e) => e.text).join('') || reason;
    } catch {
      reasonText = reason;
    }

    const reasonStr = String(reasonText);
    const reasonLower = reasonStr.toLowerCase();
    const isBanned = reasonLower.includes('ban') || reasonLower.includes('แบน');

    if (isBanned) {
      log(accountConfig.name, `โดนแบน: ${reasonStr}`);
      updateStatus(index, `โดนแบน: ${reasonStr}`, STATUS.BANNED);
      botStatusList[index].lastError = reasonStr;
    } else {
      log(accountConfig.name, `ถูกเตะ: ${reasonStr}`);
      updateStatus(index, `ถูกเตะ: ${reasonStr}`, STATUS.KICKED);
      botStatusList[index].lastError = reasonStr;
    }
    
    botInstances[index] = null;
    
    if (AUTO_RECONNECT && isRunning && !isBanned) {
      if (MAX_RECONNECT_ATTEMPTS !== -1 && botStatusList[index].reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        log(accountConfig.name, `[STOP] ยกเลิกการเชื่อมต่อใหม่ (พยายามครบ ${MAX_RECONNECT_ATTEMPTS} ครั้งแล้ว)`);
        updateStatus(index, `เกินขีดจำกัด Reconnect (${MAX_RECONNECT_ATTEMPTS} ครั้ง)`, STATUS.ERROR);
      } else {
        botStatusList[index].reconnectAttempts = (botStatusList[index].reconnectAttempts || 0) + 1;
        log(accountConfig.name, `จะพยายามเชื่อมต่อใหม่ครั้งที่ ${botStatusList[index].reconnectAttempts} ใน ${RECONNECT_DELAY/1000} วินาที...`);
        setTimeout(() => {
          if (isRunning && !botInstances[index]) {
            reconnectBot(index);
          }
        }, RECONNECT_DELAY);
      }
    }
  });

  bot.on('error', (err) => {
    log(accountConfig.name, `ข้อผิดพลาด: ${err.message}`);
    updateStatus(index, `ข้อผิดพลาด: ${err.message}`, STATUS.ERROR);
    botStatusList[index].lastError = err.message;
  });

  bot.on('end', (reason) => {
    log(accountConfig.name, `ตัดการเชื่อมต่อ: ${reason}`);
    const currentCode = botStatusList[index]?.statusCode;
    if (currentCode !== STATUS.KICKED && currentCode !== STATUS.BANNED && currentCode !== STATUS.MANUAL_STOP) {
      updateStatus(index, `ตัดการเชื่อมต่อ: ${reason || 'ไม่ทราบสาเหตุ'}`, STATUS.ERROR);
    }
    botInstances[index] = null;
    
    if (AUTO_RECONNECT && isRunning && currentCode !== STATUS.KICKED && currentCode !== STATUS.BANNED && currentCode !== STATUS.MANUAL_STOP) {
      if (MAX_RECONNECT_ATTEMPTS !== -1 && botStatusList[index].reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        log(accountConfig.name, `[STOP] ยกเลิกการเชื่อมต่อใหม่ (พยายามครบ ${MAX_RECONNECT_ATTEMPTS} ครั้งแล้ว)`);
        updateStatus(index, `เกินขีดจำกัด Reconnect (${MAX_RECONNECT_ATTEMPTS} ครั้ง)`, STATUS.ERROR);
      } else {
        botStatusList[index].reconnectAttempts = (botStatusList[index].reconnectAttempts || 0) + 1;
        log(accountConfig.name, `จะพยายามเชื่อมต่อใหม่ครั้งที่ ${botStatusList[index].reconnectAttempts} ใน ${RECONNECT_DELAY/1000} วินาที...`);
        setTimeout(() => {
          if (isRunning && !botInstances[index]) {
            reconnectBot(index);
          }
        }, RECONNECT_DELAY);
      }
    }
  });

  bot.on('messagestr', (message) => {
    const firstOnlineIndex = botInstances.findIndex(b => b != null);
    if (firstOnlineIndex === index) {
      log('CHAT', message);
    }

    if (botStatusList[index]) {
      const msgLower = message.toLowerCase();
      if ((msgLower.includes('ban') || msgLower.includes('แบน')) && 
          (msgLower.includes('banned') || msgLower.includes('ถูกแบน') || msgLower.includes('โดนแบน') || msgLower.includes('reason'))) {
        log(accountConfig.name, `โดนแบน (Chat): ${message}`);
        updateStatus(index, `โดนแบน: ระบบตรวจพบคำว่าแบน`, STATUS.BANNED);
        botStatusList[index].lastError = message;
        try { bot.quit(); } catch(e) {}
        return;
      }

      if (botStatusList[index].checkingMoney) {
        const msgLower = message.toLowerCase();
        if (msgLower.includes('เงิน') || msgLower.includes('balance') || msgLower.includes('คงเหลือ') || msgLower.includes('$') || msgLower.includes('บาท')) {
          const moneyMatch = message.match(/(?:[\$]|(?:\s|^))([\d,]+(?:\.\d{1,2})?)/);
          if (moneyMatch && moneyMatch[1]) {
            accountConfig.balance = moneyMatch[1];
            botStatusList[index].balance = moneyMatch[1];
            saveAccountsToFile(); 
            botStatusList[index].checkingMoney = false; 
          }
        }
      }
      
      if (botStatusList[index].checkingStar) {
        const msgLower = message.toLowerCase();
        if (msgLower.includes('ดาว') || msgLower.includes('star') || msgLower.includes('✨')) {
          const starMatch = message.match(/([\d,]+)/);
          if (starMatch && starMatch[1]) {
            accountConfig.star = starMatch[1];
            botStatusList[index].star = starMatch[1];
            saveAccountsToFile();
            botStatusList[index].checkingStar = false;
          }
        }
      }
    }
  });

  bot.on('title', (text) => {
    if (!text) return;
    const parsedText = typeof text === 'string' ? text : (text.text || JSON.stringify(text));
    const msgLower = parsedText.toLowerCase();
    if ((msgLower.includes('ban') || msgLower.includes('แบน')) && 
        (msgLower.includes('banned') || msgLower.includes('ถูกแบน') || msgLower.includes('โดนแบน'))) {
      log(accountConfig.name, `โดนแบน (Title): ${parsedText}`);
      updateStatus(index, `โดนแบน: ระบบตรวจพบคำว่าแบนบนหน้าจอ`, STATUS.BANNED);
      botStatusList[index].lastError = text;
      try { bot.quit(); } catch(e) {}
    }
  });

  bot.on('death', async () => {
    log(accountConfig.name, '[WARN] บอทตาย!');
    updateStatus(index, '[WARN] ตาย — รอเกิดใหม่...', STATUS.ERROR);

    if (accountConfig.autoRespawn !== false) {
      log(accountConfig.name, 'Auto Respawn ทำงาน — กำลังเกิดใหม่ใน 3 วินาที');
      await sleep(3000);
      try {
        bot.chat('/respawn'); 
        if (bot._client) {
          bot._client.write('client_command', { actionId: 0 }); 
        }
        log(accountConfig.name, 'ส่งคำสั่งเกิดใหม่แล้ว');
      } catch (err) {
        log(accountConfig.name, 'เกิดข้อผิดพลาดตอน Respawn: ' + err.message);
      }
    } else {
      log(accountConfig.name, 'ปิด Auto Respawn ไว้ — บอทจะไม่เกิดใหม่');
    }
  });

  return bot;
}

let botConnectQueue = Promise.resolve();

async function connectBotWithWait(index) {
  if (!isRunning) return;
  if (botStatusList[index]?.statusCode === STATUS.MANUAL_STOP) {
    log(accountList[index].name, '[STOP] ถูกยกเลิกขณะรอคิว — ข้ามการเชื่อมต่อ');
    return;
  }
  
  botStatusList[index].startedAt = Date.now();
  updateStatus(index, 'กำลังเริ่มเชื่อมต่อ...', STATUS.CONNECTING);
  try {
    await createBot(accountList[index], index);

    // รอให้บอทเข้าระบบเสร็จก่อนเริ่มตัวถัดไป
    let waited = 0;
    log('SYSTEM', `รอให้บอท ${accountList[index].name} เข้าระบบสำเร็จก่อนเริ่มคิวถัดไป...`);
    while (isRunning && botStatusList[index]) {
      const s = botStatusList[index].statusCode;
      if (s === STATUS.AFK_ACTIVE || s === STATUS.ERROR || s === STATUS.KICKED) {
        break;
      }
      await sleep(1000);
      waited++;
      if (waited >= 45) { // Time out after 45 seconds
        log('SYSTEM', `[Timeout] บอท ${accountList[index].name} ใช้เวลาเข้าระบบนานเกินไป (45 วิ) ข้ามไปคิวถัดไป...`);
        updateStatus(index, 'เชื่อมต่อขัดข้อง (หมดเวลา 45 วิ)', STATUS.ERROR);
        if (botInstances[index]) {
          try { botInstances[index].quit(); } catch(e) {}
          botInstances[index] = null;
        }
        break;
      }
    }
  } catch (err) {
    log(accountList[index].name, `ไม่สามารถสร้างบอทได้: ${err.message}`);
    updateStatus(index, `ข้อผิดพลาด: ${err.message}`, STATUS.ERROR);
  }

  if (isRunning) {
    await sleep(QUEUE_DELAY); // ดีเลย์ตามที่ตั้งค่าไว้
  }
}

async function startAllBots() {
  if (isRunning) return { success: false, message: 'บอทกำลังทำงานอยู่แล้ว' };
  isRunning = true;

  botStatusList.length = 0;
  botInstances.length = 0;

  for (let i = 0; i < accountList.length; i++) {
    const isEnabled = accountList[i].enabled !== false;
    botStatusList.push({
      name: accountList[i].name,
      status: isEnabled ? 'จัดคิวรอเข้า...' : 'ปิดการใช้งาน',
      statusCode: STATUS.IDLE,
      startedAt: null,
      lastError: null,
      reconnectAttempts: 0,
    });
  }

  // ไม่ต้องรอให้เสร็จทั้งหมดในฟังก์ชันเดียว ให้รันเบื้องหลังเพื่อไม่ให้ UI ค้าง
  (async () => {
    // รีเซ็ตคิว
    botConnectQueue = Promise.resolve();
    for (let i = 0; i < accountList.length; i++) {
      if (accountList[i].enabled !== false) {
        botConnectQueue = botConnectQueue.then(() => connectBotWithWait(i));
      }
    }
  })();

  return { success: true, message: `เริ่มจัดคิวรันบอททีละตัวแล้ว` };
}

function stopAllBots() {
  for (let i = 0; i < botInstances.length; i++) {
    if (botInstances[i]) {
      try {
        botInstances[i].quit();
      } catch {  }
      botInstances[i] = null;
      updateStatus(i, 'หยุดทำงานแล้ว', STATUS.IDLE);
    }
  }
  isRunning = false;
  return { success: true, message: 'หยุดบอททั้งหมดแล้ว' };
}

async function reconnectBot(index) {
  if (index < 0 || index >= accountList.length) {
    return { success: false, message: 'ดัชนีบอทไม่ถูกต้อง' };
  }
  if (botStatusList[index]?.statusCode === STATUS.MANUAL_STOP) {
    return { success: false, message: 'บอทถูกยกเลิกแล้ว' };
  }

  if (botInstances[index]) {
    try { botInstances[index].quit(); } catch {  }
    botInstances[index] = null;
  }

  updateStatus(index, 'รอคิวเชื่อมต่อใหม่...', STATUS.RECONNECTING);
  botStatusList[index].startedAt = Date.now();
  botStatusList[index].lastError = null;
  botStatusList[index].reconnectAttempts = 0;

  // เอาไปต่อท้ายคิวแทนการเชื่อมต่อทันที เพื่อไม่ให้แย่งกัน
  botConnectQueue = botConnectQueue.then(() => connectBotWithWait(index));
  
  return { success: true, message: `เพิ่ม ${accountList[index].name} เข้าคิวเชื่อมต่อใหม่แล้ว` };
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/status', (req, res) => {
  const statusData = botStatusList.map((bot, i) => ({
    index: i,
    name: bot.name,
    status: bot.status,
    statusCode: bot.statusCode,
    uptime: bot.startedAt ? Math.floor((Date.now() - bot.startedAt) / 1000) : 0,
    lastError: bot.lastError,
    online: botInstances[i] != null,
    balance: bot.balance || accountList[i]?.balance || 'ไม่ทราบ',
    star: bot.star || accountList[i]?.star || '0',
  }));
  res.json({ bots: statusData, isRunning, totalBots: accountList.length, serverHost: SERVER_HOST, serverVersion: SERVER_VERSION });
});

app.post('/api/start', async (req, res) => {
  const result = await startAllBots();
  res.json(result);
});

app.post('/api/stop', (req, res) => {
  const result = stopAllBots();
  res.json(result);
});

app.post('/api/fetch-money', (req, res) => {
  let count = 0;
  botInstances.forEach((bot, i) => {
    if (bot && botStatusList[i]) {
      botStatusList[i].checkingMoney = true;
      bot.chat('/money');
      count++;
      setTimeout(() => { if (botStatusList[i]) botStatusList[i].checkingMoney = false; }, 5000);
    }
  });
  res.json({ success: true, message: `สั่งเช็คเงิน ${count} บอท` });
});

app.post('/api/fetch-star', (req, res) => {
  let count = 0;
  botInstances.forEach((bot, i) => {
    if (bot && botStatusList[i]) {
      botStatusList[i].checkingStar = true;
      bot.chat('/star bal');
      count++;
      setTimeout(() => { if (botStatusList[i]) botStatusList[i].checkingStar = false; }, 5000);
    }
  });
  res.json({ success: true, message: `สั่งเช็คดาว ${count} บอท` });
});

app.post('/api/pay-star', (req, res) => {
  const { targetName } = req.body;
  if (!targetName || typeof targetName !== 'string') {
    return res.json({ success: false, message: 'กรุณาระบุชื่อเป้าหมาย' });
  }

  let count = 0;
  botInstances.forEach((bot, i) => {
    if (bot && botStatusList[i] && accountList[i].name.toLowerCase() !== targetName.toLowerCase()) {
      const starStr = String(botStatusList[i].star || '0');
      const starAmt = parseInt(starStr.replace(/,/g, ''));
      if (starAmt > 0) {
        bot.chat(`/star pay ${targetName} ${starAmt}`);
        count++;
        // รีเซ็ตดาวเป็น 0 ไปเลยเพราะโอนหมดแล้ว
        botStatusList[i].star = '0';
        accountList[i].star = '0';
      }
    }
  });
  saveAccountsToFile();
  res.json({ success: true, message: `ส่งคำสั่งโอนดาวให้ ${targetName} จาก ${count} บอท (เฉพาะบอทที่มีดาว)` });
});

app.post('/api/afk', (req, res) => {
  let count = 0;
  botInstances.forEach((bot, i) => {
    if (bot && botStatusList[i]) {
      bot.chat('/afk');
      count++;
    }
  });
  res.json({ success: true, message: `ส่งคำสั่ง /afk ให้ ${count} บอท` });
});

app.post('/api/reconnect/:index', async (req, res) => {
  const result = await reconnectBot(parseInt(req.params.index));
  res.json(result);
});

app.post('/api/stop/:index', (req, res) => {
  const index = parseInt(req.params.index);
  if (index < 0 || index >= accountList.length) {
    return res.json({ success: false, message: 'ดัชนีบอทไม่ถูกต้อง' });
  }

  if (botInstances[index]) {
    botStatusList[index].statusCode = STATUS.MANUAL_STOP;
    try { botInstances[index].quit(); } catch {  }
    botInstances[index] = null;
  } else {
    botStatusList[index].statusCode = STATUS.MANUAL_STOP;
  }
  
  updateStatus(index, 'ยกเลิกการทำงาน', STATUS.MANUAL_STOP);
  res.json({ success: true, message: `ยกเลิกบอท ${accountList[index].name} สำเร็จ` });
});

app.get('/api/config', (req, res) => {
  res.json({ 
    serverHost: SERVER_HOST, 
    serverVersion: SERVER_VERSION,
    autoReconnect: AUTO_RECONNECT,
    reconnectDelay: RECONNECT_DELAY,
    queueDelay: QUEUE_DELAY,
    maxReconnectAttempts: MAX_RECONNECT_ATTEMPTS,
    spoofIp: SPOOF_IP,
    lowRamMode: LOW_RAM_MODE
  });
});

app.post('/api/config', (req, res) => {
  const { serverHost, serverVersion, autoReconnect, reconnectDelay, spoofIp, lowRamMode } = req.body;
  if (isRunning) {
    return res.json({ success: false, message: 'ไม่สามารถเปลี่ยนค่าได้ขณะบอทกำลังทำงาน — กรุณาหยุดบอทก่อน' });
  }
  if (serverHost && typeof serverHost === 'string' && serverHost.trim()) {
    SERVER_HOST = serverHost.trim();
  }
  if (serverVersion && typeof serverVersion === 'string' && serverVersion.trim()) {
    SERVER_VERSION = serverVersion.trim();
  }
  if (typeof autoReconnect === 'boolean') {
    AUTO_RECONNECT = autoReconnect;
  }
  if (typeof reconnectDelay === 'number' && reconnectDelay >= 1000) {
    RECONNECT_DELAY = reconnectDelay;
  }
  if (typeof req.body.queueDelay === 'number' && req.body.queueDelay >= 1000) {
    QUEUE_DELAY = req.body.queueDelay;
  }
  if (typeof req.body.maxReconnectAttempts === 'number') {
    MAX_RECONNECT_ATTEMPTS = req.body.maxReconnectAttempts;
  }
  if (typeof spoofIp === 'boolean') {
    SPOOF_IP = spoofIp;
  }
  if (typeof lowRamMode === 'boolean') {
    LOW_RAM_MODE = lowRamMode;
  }
  log('SYSTEM', `อัพเดตการตั้งค่า — Host: ${SERVER_HOST}, Version: ${SERVER_VERSION}, Reconnect: ${AUTO_RECONNECT}, SpoofIP: ${SPOOF_IP}, LowRAM: ${LOW_RAM_MODE}, MaxAttempts: ${MAX_RECONNECT_ATTEMPTS === -1 ? 'ไม่จำกัด' : MAX_RECONNECT_ATTEMPTS}`);
  res.json({ success: true, message: 'บันทึกการตั้งค่าเรียบร้อย', serverHost: SERVER_HOST, serverVersion: SERVER_VERSION, autoReconnect: AUTO_RECONNECT, spoofIp: SPOOF_IP, lowRamMode: LOW_RAM_MODE, reconnectDelay: RECONNECT_DELAY, queueDelay: QUEUE_DELAY, maxReconnectAttempts: MAX_RECONNECT_ATTEMPTS });
});

app.get('/api/logs', (req, res) => {
  res.json({ logs: logBuffer });
});

app.post('/api/logs/clear', (req, res) => {
  logBuffer.length = 0;
  res.json({ success: true });
});

app.post('/api/chat', (req, res) => {
  const { message, botName } = req.body;
  if (!message) return res.json({ success: false });

  let activeBot = null;
  if (botName) {
    const idx = accountList.findIndex(a => a.name === botName);
    if (idx !== -1) activeBot = botInstances[idx];
  }
  if (!activeBot) {
    activeBot = botInstances.find(b => b != null);
  }

  if (activeBot) {
    try {
      activeBot.chat(message);
      log('USER', `ส่งข้อความ: ${message}`);
      res.json({ success: true });
    } catch (err) {
      res.json({ success: false, message: 'บอทยังไม่พร้อมส่งข้อความ' });
    }
  } else {
    res.json({ success: false, message: 'ไม่มีบอททำงานอยู่ (กรุณากด "เริ่มบอททั้งหมด" ก่อน)' });
  }
});

app.get('/api/accounts', (req, res) => {
  res.json({
    accounts: accountList.map((a, i) => ({
      index: i,
      name: a.name,
      password: a.password,
      pin: a.pin,
      targetServer: a.targetServer,
      autoRespawn: a.autoRespawn,
      balance: a.balance || '0.00',
      star: a.star || '0',
      enabled: a.enabled !== false
    })),
  });
});

app.post('/api/accounts', (req, res) => {
  const { name, password, pin, targetServer, autoRespawn } = req.body;

  if (!name || !password || !pin || !targetServer) {
    return res.json({ success: false, message: 'กรุณากรอกข้อมูลให้ครบทุกช่อง' });
  }

  let pinArray;
  if (SERVER_HOST.toLowerCase().includes('amory')) {
    pinArray = typeof pin === 'string' ? pin.trim() : '';
    if (!pinArray) {
      return res.json({ success: false, message: 'กรุณากรอกอีเมล' });
    }
  } else {
    if (typeof pin === 'string') {
      pinArray = pin.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
    } else if (Array.isArray(pin)) {
      pinArray = pin.map(n => parseInt(n)).filter(n => !isNaN(n));
    } else {
      return res.json({ success: false, message: 'PIN ไม่ถูกต้อง' });
    }

    if (pinArray.length === 0) {
      return res.json({ success: false, message: 'กรุณากรอก PIN อย่างน้อย 1 หลัก' });
    }
  }

  if (accountList.some(a => a.name === name)) {
    return res.json({ success: false, message: 'บอทชื่อ "' + name + '" มีอยู่แล้ว' });
  }

  accountList.push({ name, password, pin: pinArray, targetServer, autoRespawn: autoRespawn !== false });
  saveAccountsToFile();
  log('SYSTEM', 'เพิ่มบอทใหม่: ' + name + ' (เซิร์ฟเวอร์: ' + targetServer + ')');
  res.json({ success: true, message: 'เพิ่มบอท "' + name + '" สำเร็จ' });
});

app.post('/api/accounts/:index/toggle', (req, res) => {
  if (isRunning) return res.json({ success: false, message: 'ไม่สามารถเปิด/ปิดได้ขณะบอทกำลังทำงาน' });
  const index = parseInt(req.params.index);
  if (accountList[index]) {
    accountList[index].enabled = accountList[index].enabled === false ? true : false;
    saveAccountsToFile();
    res.json({ success: true, enabled: accountList[index].enabled });
  } else {
    res.json({ success: false, message: 'ไม่พบบัญชี' });
  }
});

app.delete('/api/accounts/:index', (req, res) => {
  const index = parseInt(req.params.index);
  if (index < 0 || index >= accountList.length) {
    return res.json({ success: false, message: 'ดัชนีไม่ถูกต้อง' });
  }

  if (isRunning) {
    return res.json({ success: false, message: 'ไม่สามารถลบบอทขณะกำลังทำงาน — กรุณาหยุดบอทก่อน' });
  }

  const removed = accountList.splice(index, 1)[0];
  saveAccountsToFile();
  log('SYSTEM', 'ลบบอท: ' + removed.name);
  res.json({ success: true, message: 'ลบบอท "' + removed.name + '" สำเร็จ' });
});

app.get('/', (req, res) => {
  res.send(getDashboardHTML());
});

function getDashboardHTML() {
  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Overmine AFK Bot — Dashboard</title>
  <meta name="description" content="Multi-Bot Minecraft AFK System Dashboard for play.overmine.net">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <div class="app">

    <header class="header">
      <div class="header__badge">
        <span class="dot"></span>
        Overmine AFK System
      </div>
      <h1>Bot Dashboard</h1>
      <p id="headerSubtitle">play.overmine.net • Minecraft 1.20.1</p>
    </header>

    <div class="config-panel" id="configPanel">
      <div class="config-panel__header" onclick="toggleConfig()">
        <div class="config-panel__title">
          <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          ตั้งค่าเซิร์ฟเวอร์
        </div>
        <span class="config-panel__toggle" id="configToggleIcon">▼</span>
      </div>
      <div class="config-panel__body" id="configBody">
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
          <div class="config-field">
            <label for="inputHost">IP เซิร์ฟเวอร์</label>
            <input type="text" id="inputHost" placeholder="play.overmine.net" />
          </div>
          <div class="config-field">
            <label for="inputVersion">เวอร์ชันเกม</label>
            <input type="text" id="inputVersion" placeholder="1.20.1" />
          </div>
          <div class="config-field">
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
              <input type="checkbox" id="inputAutoReconnect" checked style="width:16px; height:16px; accent-color:#6366f1;" />
              Auto Reconnect เมื่อบอทหลุด
            </label>
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer; margin-top:8px;">
              <input type="checkbox" id="inputSpoofIp" style="width:16px; height:16px; accent-color:#6366f1;" />
              เปิดใช้ Spoof IP (Bypass ลิมิตไอพี)
            </label>
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer; margin-top:8px;">
              <input type="checkbox" id="inputLowRamMode" style="width:16px; height:16px; accent-color:#6366f1;" />
              โหมดประหยัด RAM (ปิดฟิสิกส์ตอน AFK)
            </label>
          </div>
          <div class="config-field">
            <label for="inputReconnectDelay">ดีเลย์ Reconnect (วินาที)</label>
            <input type="number" id="inputReconnectDelay" placeholder="10" min="1" max="300" />
          </div>
          <div class="config-field">
            <label for="inputMaxReconnect">จำกัดเชื่อมต่อใหม่ (ครั้ง)</label>
            <select id="inputMaxReconnect" style="width:100%; background:#1f2937; border:1px solid #374151; color:#fff; padding:8px; border-radius:4px; font-size:14px; outline:none; font-family:inherit;">
              <option value="-1">ไม่จำกัด</option>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="4">4</option>
              <option value="5">5</option>
              <option value="6">6</option>
              <option value="7">7</option>
              <option value="8">8</option>
              <option value="9">9</option>
              <option value="10">10</option>
            </select>
          </div>
          <div class="config-field" style="grid-column: 1 / -1;">
            <label for="inputQueueDelay">ดีเลย์เข้าคิว (หน่วงเวลาระหว่างเข้าบอทแต่ละตัว): <span id="queueDelayDisplay" style="color:#6366f1; font-weight:bold;">2</span> วินาที</label>
            <input type="range" id="inputQueueDelay" min="1" max="60" value="2" oninput="document.getElementById('queueDelayDisplay').innerText = this.value" style="width: 100%; cursor: pointer; accent-color:#6366f1;" />
          </div>
        </div>
        <button class="btn btn-save-config" onclick="saveConfig()" style="margin-top:16px; width:100%;">
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
          บันทึก
        </button>
      </div>
      <div class="config-current" id="configCurrent">
        <span class="config-tag"><span class="tag-label">IP:</span> <span id="tagHost">play.overmine.net</span></span>
        <span class="config-tag"><span class="tag-label">Version:</span> <span id="tagVersion">1.20.1</span></span>
        <span class="config-tag"><span class="tag-label">Reconnect:</span> <span id="tagReconnect">เปิด (10 วิ)</span></span>
      </div>
    </div>

    <div class="accounts-panel" id="accountsPanel">
      <div class="accounts-panel__header" onclick="toggleAccounts()">
        <div class="accounts-panel__title">
          <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          จัดการบอท <span class="accounts-panel__count" id="accountsCount">0 บัญชี</span>
        </div>
        <span class="config-panel__toggle" id="accountsToggleIcon">▼</span>
      </div>
      <div class="accounts-panel__body" id="accountsBody">
        <div class="add-account-form">
          <div class="config-field">
            <label for="accName">ชื่อบอท</label>
            <input type="text" id="accName" placeholder="เช่น Bot_AFK_03" />
          </div>
          <div class="config-field">
            <label for="accPassword">รหัสผ่าน</label>
            <input type="password" id="accPassword" placeholder="รหัสผ่านสำหรับ /login" />
          </div>
          <div class="config-field">
            <label for="accPin" id="accPinLabel">PIN (Slot Numbers)</label>
            <input type="text" id="accPin" placeholder="เช่น 15, 26, 15, 16, 26, 17" />
          </div>
          <div class="config-field">
            <label for="accTargetServer">เซิร์ฟเวอร์เป้าหมาย</label>
            <select id="accTargetServer" class="form-select">
              <option value="classic">Classic</option>
              <option value="arena">Arena</option>
              <option value="fantasy">Fantasy</option>
              <option value="oneblock">OneBlock</option>
            </select>
          </div>
          <div class="config-field" style="grid-column: 1 / -1;">
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
              <input type="checkbox" id="accAutoRespawn" checked style="width:16px; height:16px;" />
              Auto Respawn เมื่อบอทตาย
            </label>
          </div>
          <div class="form-actions" style="grid-column: 1 / -1;">
            <button class="btn btn-add-account" onclick="addAccount()">
              <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              เพิ่มบอท
            </button>
          </div>
        </div>
        <div class="account-list" id="accountList">
          <div class="accounts-empty">กำลังโหลด...</div>
        </div>
      </div>
    </div>

    <div class="stats-bar" id="statsBar">
      <div class="stat-chip total">
        <span class="stat-label">บอททั้งหมด</span>
        <span class="stat-value" id="statTotal">0</span>
      </div>
      <div class="stat-chip online">
        <span class="stat-label">ออนไลน์</span>
        <span class="stat-value" id="statOnline">0</span>
      </div>
      <div class="stat-chip kicked">
        <span class="stat-label">ถูกเตะ/ข้อผิดพลาด</span>
        <span class="stat-value" id="statError">0</span>
      </div>
    </div>

    <div class="controls">
      <button class="btn btn-start" id="btnStart" onclick="startBots()">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        เริ่มบอททั้งหมด
      </button>
      <button class="btn btn-stop" id="btnStop" onclick="stopBots()" disabled>
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
        หยุดบอททั้งหมด
      </button>
      <button class="btn" style="background:#4b5563;color:#fff;" onclick="fetchMoney()">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        Fetch Money
      </button>
      <button class="btn" style="background:#4b5563;color:#fff;" onclick="fetchStar()">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        Fetch Star
      </button>
      <button class="btn" style="background:#4b5563;color:#fff;" onclick="afkAllBots()">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        AFK ทั้งหมด
      </button>
      <div style="display:inline-flex; align-items:center; gap:8px; margin-left:8px; border-left:1px solid #374151; padding-left:12px;">
        <input type="text" id="starPayTarget" placeholder="ชื่อคนรับดาว..." style="background:#1f2937; border:1px solid #374151; color:#fff; padding:6px 12px; border-radius:4px; font-size:13px; width: 120px;" />
        <button class="btn" style="background:#6366f1;color:#fff;" onclick="payStar()">โอนดาวทั้งหมด</button>
      </div>
    </div>

    <div class="bots-grid" id="botsGrid">
      <div class="empty-state">
        <div class="empty-state__icon"><svg width="56" height="56" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="8.5" cy="16" r="1.5"/><circle cx="15.5" cy="16" r="1.5"/><path d="M12 11V7"/><circle cx="12" cy="5" r="2"/></svg></div>
        <div class="empty-state__title">ยังไม่มีบอทเริ่มทำงาน</div>
        <div class="empty-state__desc">กดปุ่ม "เริ่มบอททั้งหมด" เพื่อเริ่มต้น</div>
      </div>
    </div>

    <div class="log-panel" id="logPanel">
      <div class="log-panel__header" onclick="toggleLogs()">
        <div class="log-panel__title">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
          Console Log
        </div>
        <div class="log-panel__actions">
          <select id="logFilter" class="log-filter" onclick="event.stopPropagation()" onchange="changeLogFilter()">
            <option value="all">รวมทุกตัว</option>
          </select>
          <span class="log-panel__count" id="logCount">0 บรรทัด</span>
          <button class="btn-clear-log" onclick="event.stopPropagation(); clearLogs()">ล้าง Log</button>
          <span class="config-panel__toggle" id="logToggleIcon">▼</span>
        </div>
      </div>
      <div class="log-panel__body" id="logBody">
        <div class="log-empty">ยังไม่มี log — เริ่มบอทเพื่อดู log</div>
      </div>
      <form class="chat-form" id="chatForm" onsubmit="sendChat(event)">
        <input type="text" class="chat-input" id="chatInput" placeholder="พิมพ์ข้อความหรือคำสั่งที่นี่ (เช่น /spawn)..." autocomplete="off" />
        <button type="submit" class="btn-chat">ส่ง</button>
      </form>
    </div>
  </div>

  <div class="toast-container" id="toastContainer"></div>

  <script>

    function formatUptime(seconds) {
      if (!seconds || seconds <= 0) return '00:00:00';
      const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
      const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
      const s = (seconds % 60).toString().padStart(2, '0');
      return h + ':' + m + ':' + s;
    }

    function getStatusClass(statusCode) {
      switch (statusCode) {
        case 'afk_active': return 'online';
        case 'banned': return 'error';
        case 'manual_stop': return 'idle';
        case 'kicked':
        case 'error': return 'error';
        case 'idle': return 'idle';
        default: return 'working';
      }
    }

    function getStatusLabel(statusCode) {
      switch (statusCode) {
        case 'afk_active': return 'AFK';
        case 'banned': return 'BANNED';
        case 'manual_stop': return 'STOPPED';
        case 'kicked': return 'KICKED';
        case 'error': return 'ERROR';
        case 'idle': return 'IDLE';
        case 'connecting': return 'CONNECTING';
        case 'limbo_auth': return 'AUTH';
        case 'pin_entry': return 'PIN';
        case 'lobby': return 'LOBBY';
        case 'searching_entity': return 'SEARCHING';
        case 'entering_smp': return 'ENTERING';
        case 'reconnecting': return 'RECONNECTING';
        default: return 'WORKING';
      }
    }

    function showToast(message, type = 'success') {
      const container = document.getElementById('toastContainer');
      const toast = document.createElement('div');
      toast.className = 'toast ' + type;
      toast.textContent = message;
      container.appendChild(toast);
      setTimeout(() => {
        toast.style.animation = 'toast-out 0.3s forwards';
        setTimeout(() => toast.remove(), 300);
      }, 3500);
    }

    async function stopBot(index) {
      try {
        const res = await fetch('/api/stop/' + index, { method: 'POST' });
        const data = await res.json();
        showToast(data.message, data.success ? 'success' : 'error');
        if (data.success) fetchStatus();
      } catch (err) {
        showToast('เชื่อมต่อผิดพลาด: ' + err.message, 'error');
      }
    }

    async function startBots() {
      const btn = document.getElementById('btnStart');
      btn.disabled = true;
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg> กำลังเริ่ม...';

      try {
        const res = await fetch('/api/start', { method: 'POST' });
        const data = await res.json();
        showToast(data.message, data.success ? 'success' : 'error');
        document.getElementById('btnStop').disabled = false;
      } catch (err) {
        showToast('ข้อผิดพลาด: ' + err.message, 'error');
        btn.disabled = false;
      }

      btn.innerHTML = '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg> เริ่มบอททั้งหมด';
    }

    async function stopBots() {
      try {
        const res = await fetch('/api/stop', { method: 'POST' });
        const data = await res.json();
        showToast(data.message, data.success ? 'success' : 'error');
        document.getElementById('btnStart').disabled = false;
        document.getElementById('btnStop').disabled = true;
      } catch (err) {
        showToast('ข้อผิดพลาด: ' + err.message, 'error');
      }
    }

    async function reconnectBot(index) {
      const btn = document.querySelector('[data-reconnect="' + index + '"]');
      if (btn) { btn.disabled = true; btn.textContent = 'กำลังเชื่อมต่อ...'; }

      try {
        const res = await fetch('/api/reconnect/' + index, { method: 'POST' });
        const data = await res.json();
        showToast(data.message, data.success ? 'success' : 'error');
      } catch (err) {
        showToast('ข้อผิดพลาด: ' + err.message, 'error');
      }
    }

    async function fetchMoney() {
      try {
        const res = await fetch('/api/fetch-money', { method: 'POST' });
        const data = await res.json();
        showToast(data.message, data.success ? 'success' : 'error');
        if (data.success) {
          setTimeout(loadAccounts, 2500);
        }
      } catch (err) {
        showToast('ข้อผิดพลาด: ' + err.message, 'error');
      }
    }

    async function fetchStar() {
      try {
        const res = await fetch('/api/fetch-star', { method: 'POST' });
        const data = await res.json();
        showToast(data.message, data.success ? 'success' : 'error');
        if (data.success) {
          setTimeout(loadAccounts, 2500);
        }
      } catch (err) {
        showToast('ข้อผิดพลาด: ' + err.message, 'error');
      }
    }

    async function afkAllBots() {
      try {
        const res = await fetch('/api/afk', { method: 'POST' });
        const data = await res.json();
        showToast(data.message, data.success ? 'success' : 'error');
      } catch (err) {
        showToast('ข้อผิดพลาด: ' + err.message, 'error');
      }
    }

    async function payStar() {
      const targetName = document.getElementById('starPayTarget').value.trim();
      if (!targetName) {
        showToast('กรุณากรอกชื่อคนรับดาว', 'error');
        return;
      }
      try {
        const res = await fetch('/api/pay-star', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetName })
        });
        const data = await res.json();
        showToast(data.message, data.success ? 'success' : 'error');
        if (data.success) {
          setTimeout(loadAccounts, 1000);
        }
      } catch (err) {
        showToast('ข้อผิดพลาด: ' + err.message, 'error');
      }
    }

    function renderBots(data) {
      const grid = document.getElementById('botsGrid');

      const filterSelect = document.getElementById('logFilter');
      const currentVal = filterSelect.value;
      let optionsHtml = '<option value="all">รวมทุกตัว</option>';
      if (data.bots && data.bots.length > 0) {
        data.bots.forEach(b => {
          optionsHtml += '<option value="' + escapeHtml(b.name) + '">' + escapeHtml(b.name) + '</option>';
        });
      }
      if (filterSelect.innerHTML !== optionsHtml) {
        filterSelect.innerHTML = optionsHtml;
        if (data.bots.some(b => b.name === currentVal) || currentVal === 'all') {
          filterSelect.value = currentVal;
        } else {
          filterSelect.value = 'all';
          currentLogFilter = 'all';
        }
      }

      document.getElementById('statTotal').textContent = data.totalBots;
      document.getElementById('statOnline').textContent = data.bots.filter(b => b.online).length;
      document.getElementById('statError').textContent = data.bots.filter(b => b.statusCode === 'kicked' || b.statusCode === 'error').length;

      document.getElementById('btnStart').disabled = data.isRunning;
      document.getElementById('btnStop').disabled = !data.isRunning;

      if (data.bots.length === 0) {
        grid.innerHTML = '<div class="empty-state"><div class="empty-state__icon"><svg width="56" height="56" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="8.5" cy="16" r="1.5"/><circle cx="15.5" cy="16" r="1.5"/><path d="M12 11V7"/><circle cx="12" cy="5" r="2"/></svg></div><div class="empty-state__title">ยังไม่มีบอทเริ่มทำงาน</div><div class="empty-state__desc">กดปุ่ม "เริ่มบอททั้งหมด" เพื่อเริ่มต้น</div></div>';
        return;
      }

      grid.innerHTML = data.bots.map(bot => {
        const cls = getStatusClass(bot.statusCode);
        const label = getStatusLabel(bot.statusCode);
        const initial = bot.name.charAt(0).toUpperCase();
        const showReconnect = bot.statusCode === 'kicked' || bot.statusCode === 'error' || bot.statusCode === 'manual_stop';
        const showStop = bot.statusCode !== 'idle' && bot.statusCode !== 'kicked' && bot.statusCode !== 'error' && bot.statusCode !== 'banned' && bot.statusCode !== 'manual_stop';

        return '<div class="bot-card" id="bot-card-' + bot.index + '">'
          + '<div class="bot-card__header">'
          +   '<div class="bot-card__name">'
          +     '<div class="bot-card__avatar">' + initial + '</div>'
          +     '<div>'
          +       '<div class="bot-card__title">' + bot.name + '</div>'
          +       '<div class="bot-card__index">Bot #' + (bot.index + 1) + '</div>'
          +     '</div>'
          +   '</div>'
          +   '<div class="status-indicator ' + cls + '">'
          +     '<span class="status-dot"></span>'
          +     label
          +   '</div>'
          + '</div>'
          + '<div class="bot-card__status">'
          +   '<div class="bot-card__status-text">' + escapeHtml(bot.status) + '</div>'
          + '</div>'
          + '<div class="bot-card__meta">'
          +   '<div class="bot-card__uptime" style="display:flex; justify-content:space-between; width:100%;">'
          +     '<span><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" style="vertical-align:-1px;margin-right:4px"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' + formatUptime(bot.uptime) + '</span>'
          +     '<div style="display:flex;gap:12px;">'
          +       '<span style="color:#a78bfa;"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="vertical-align:-2px;margin-right:2px"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>' + escapeHtml(bot.star || '0') + '</span>'
          +       '<span style="color:#fbbf24;"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="vertical-align:-2px;margin-right:2px"><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/></svg>' + escapeHtml(bot.balance || 'ไม่ทราบ') + '</span>'
          +     '</div>'
          +   '</div>'
          +   (showReconnect
              ? '<button class="btn btn-reconnect" data-reconnect="' + bot.index + '" onclick="reconnectBot(' + bot.index + ')"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" style="vertical-align:-1px;margin-right:3px"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> เชื่อมต่อใหม่</button>'
              : (showStop 
                ? '<button class="btn btn-stop" style="margin-left:auto; background:#ef4444; color:#fff; padding:6px 12px; font-size:12px; border-radius:4px; border:none; cursor:pointer; font-family:inherit; font-weight:600;" onclick="stopBot(' + bot.index + ')"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" style="vertical-align:-1px;margin-right:3px"><rect x="6" y="6" width="12" height="12" rx="2"/></svg> ยกเลิกบอท</button>'
                : ''))
          + '</div>'
          + '</div>';
      }).join('');
    }

    function escapeHtml(str) {
      const div = document.createElement('div');
      div.textContent = str || '';
      return div.innerHTML;
    }

    let configCollapsed = false;

    function toggleConfig() {
      configCollapsed = !configCollapsed;
      document.getElementById('configBody').classList.toggle('collapsed', configCollapsed);
      document.getElementById('configToggleIcon').textContent = configCollapsed ? '▶' : '▼';
    }

    async function loadConfig() {
      try {
        const res = await fetch('/api/config');
        const data = await res.json();
        document.getElementById('inputHost').value = data.serverHost;
        document.getElementById('inputVersion').value = data.serverVersion;
        document.getElementById('inputAutoReconnect').checked = data.autoReconnect !== false;
        if (document.getElementById('inputSpoofIp')) {
          document.getElementById('inputSpoofIp').checked = data.spoofIp === true;
        }
        if (document.getElementById('inputLowRamMode')) {
          document.getElementById('inputLowRamMode').checked = data.lowRamMode === true;
        }
        document.getElementById('tagHost').textContent = data.serverHost;
        document.getElementById('tagVersion').textContent = data.serverVersion;
        document.getElementById('headerSubtitle').textContent = data.serverHost + ' • Minecraft ' + data.serverVersion;
        
        if (data.maxReconnectAttempts !== undefined) {
          document.getElementById('inputMaxReconnect').value = data.maxReconnectAttempts.toString();
        }
        
        const pinLabel = document.getElementById('accPinLabel');
        const pinInput = document.getElementById('accPin');
        if (pinLabel && pinInput) {
          if (data.serverHost.toLowerCase().includes('amory')) {
            pinLabel.textContent = 'อีเมล (สำหรับ Register)';
            pinInput.placeholder = 'เช่น example@gmail.com';
          } else {
            pinLabel.textContent = 'PIN (Slot Numbers)';
            pinInput.placeholder = 'เช่น 15, 26, 15, 16, 26, 17';
          }
        }
      } catch {  }
    }

    let logCollapsed = false;
    let lastLogCount = 0;
    let autoScroll = true;
    let currentLogFilter = 'all';

    function changeLogFilter() {
      currentLogFilter = document.getElementById('logFilter').value;
      lastLogCount = 0; 
    }

    function toggleLogs() {
      logCollapsed = !logCollapsed;
      document.getElementById('logBody').classList.toggle('collapsed', logCollapsed);
      document.getElementById('logToggleIcon').textContent = logCollapsed ? '▶' : '▼';
    }

    function getLogMsgClass(message) {
      if (message.includes('[CHAT]')) return 'chat';
      if (message.includes('[OK]') || message.includes('สำเร็จ')) return 'success';
      if (message.includes('[ERROR]') || message.includes('ข้อผิดพลาด') || message.includes('ถูกเตะ')) return 'error';
      if (message.includes('[WARN]') || message.includes('ไม่พบ')) return 'warn';
      return '';
    }

    function renderLogs(logs) {
      const body = document.getElementById('logBody');
      const countEl = document.getElementById('logCount');

      const filteredLogs = currentLogFilter === 'all' 
        ? logs 
        : logs.filter(l => l.bot === currentLogFilter || l.bot === 'SYSTEM' || l.bot === 'USER');

      countEl.textContent = filteredLogs.length + ' บรรทัด';

      if (filteredLogs.length === 0) {
        body.innerHTML = '<div class="log-empty">ยังไม่มี log สำหรับบอทที่เลือก</div>';
        lastLogCount = logs.length;
        return;
      }

      if (logs.length === lastLogCount) return;
      lastLogCount = logs.length;

      body.innerHTML = filteredLogs.map(l => {
        const cls = getLogMsgClass(l.message);
        return '<div class="log-entry">'
          + '<span class="log-time">[' + escapeHtml(l.time) + ']</span> '
          + '<span class="log-bot">[' + escapeHtml(l.bot) + ']</span> '
          + '<span class="log-msg ' + cls + '">' + escapeHtml(l.message) + '</span>'
          + '</div>';
      }).join('');

      if (autoScroll) {
        body.scrollTop = body.scrollHeight;
      }
    }

    async function clearLogs() {
      try {
        await fetch('/api/logs/clear', { method: 'POST' });
        lastLogCount = 0;
        document.getElementById('logBody').innerHTML = '<div class="log-empty">ล้าง log เรียบร้อยแล้ว</div>';
        document.getElementById('logCount').textContent = '0 บรรทัด';
      } catch {  }
    }

    async function sendChat(e) {
      e.preventDefault();
      const input = document.getElementById('chatInput');
      const message = input.value.trim();
      if (!message) return;

      const filterVal = document.getElementById('logFilter').value;
      const botName = filterVal === 'all' ? null : filterVal;

      input.value = '';
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, botName })
        });
        const data = await res.json();
        if (!data.success) {
          showToast(data.message || 'ข้อผิดพลาดในการส่งข้อความ', 'error');
        }
      } catch (err) {
        showToast('ข้อผิดพลาดการเชื่อมต่อ: ' + err.message, 'error');
      }
    }

    document.addEventListener('DOMContentLoaded', () => {
      const logBody = document.getElementById('logBody');
      if (logBody) {
        logBody.addEventListener('scroll', () => {
          autoScroll = logBody.scrollTop + logBody.clientHeight >= logBody.scrollHeight - 30;
        });
      }
    });

    async function saveConfig() {
      const serverHost = document.getElementById('inputHost').value.trim();
      const serverVersion = document.getElementById('inputVersion').value.trim();
      const autoReconnect = document.getElementById('inputAutoReconnect').checked;
      const spoofIp = document.getElementById('inputSpoofIp') ? document.getElementById('inputSpoofIp').checked : false;
      const lowRamMode = document.getElementById('inputLowRamMode') ? document.getElementById('inputLowRamMode').checked : false;
      const reconnectDelayStr = document.getElementById('inputReconnectDelay').value.trim();
      const reconnectDelay = reconnectDelayStr ? parseInt(reconnectDelayStr) * 1000 : 10000;
      const queueDelayStr = document.getElementById('inputQueueDelay').value;
      const queueDelay = queueDelayStr ? parseInt(queueDelayStr) * 1000 : 2000;
      const maxReconnectAttempts = parseInt(document.getElementById('inputMaxReconnect').value);

      if (!serverHost || !serverVersion) {
        showToast('กรุณากรอก IP และเวอร์ชันให้ครบ', 'error');
        return;
      }

      try {
        const res = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serverHost, serverVersion, autoReconnect, spoofIp, lowRamMode, reconnectDelay, queueDelay, maxReconnectAttempts }),
        });
        const data = await res.json();
        showToast(data.message, data.success ? 'success' : 'error');
        if (data.success) {
          document.getElementById('tagHost').textContent = data.serverHost;
          document.getElementById('tagVersion').textContent = data.serverVersion;
          document.getElementById('tagReconnect').textContent = data.autoReconnect ? 'เปิด (' + (data.reconnectDelay/1000) + ' วิ)' : 'ปิด';
          document.getElementById('headerSubtitle').textContent = data.serverHost + ' • Minecraft ' + data.serverVersion;

          const pinLabel = document.getElementById('accPinLabel');
          const pinInput = document.getElementById('accPin');
          if (pinLabel && pinInput) {
            if (data.serverHost.toLowerCase().includes('amory')) {
              pinLabel.textContent = 'อีเมล (สำหรับ Register)';
              pinInput.placeholder = 'เช่น example@gmail.com';
            } else {
              pinLabel.textContent = 'PIN (Slot Numbers)';
              pinInput.placeholder = 'เช่น 15, 26, 15, 16, 26, 17';
            }
          }
        }
      } catch (err) {
        showToast('ข้อผิดพลาด: ' + err.message, 'error');
      }
    }

    let accountsCollapsed = false;

    function toggleAccounts() {
      accountsCollapsed = !accountsCollapsed;
      document.getElementById('accountsBody').classList.toggle('collapsed', accountsCollapsed);
      document.getElementById('accountsToggleIcon').textContent = accountsCollapsed ? '▶' : '▼';
    }

    async function loadAccounts() {
      try {
        const res = await fetch('/api/accounts');
        const data = await res.json();
        renderAccounts(data.accounts || []);
      } catch {  }
    }

    function renderAccounts(accounts) {
      const list = document.getElementById('accountList');
      document.getElementById('accountsCount').textContent = accounts.length + ' บัญชี';

      if (accounts.length === 0) {
        list.innerHTML = '<div class="accounts-empty">ยังไม่มีบอท — เพิ่มบอทด้วยฟอร์มด้านบน</div>';
        return;
      }

      list.innerHTML = accounts.map(function(acc) {
        var initial = acc.name.charAt(0).toUpperCase();
        return '<div class="account-item">'
          + '<div class="account-item__info">'
          +   '<div class="account-item__avatar">' + initial + '</div>'
          +   '<div class="account-item__details">'
          +     '<div class="account-item__name">' + escapeHtml(acc.name) + '</div>'
          +     '<div class="account-item__meta" style="margin-top: 4px;">'
          +       '<span>' + (Array.isArray(acc.pin) ? ('PIN: ' + acc.pin.join(', ')) : ('อีเมล: ' + escapeHtml(acc.pin))) + '</span>'
          +       '<span style="margin-left: 12px; color: #a78bfa;"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="vertical-align:-2px;margin-right:2px"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>' + escapeHtml(acc.star || '0') + '</span>'
          +       '<span style="margin-left: 12px; color: #fbbf24;"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="vertical-align:-2px;margin-right:2px"><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/></svg>' + escapeHtml(acc.balance || 'ไม่ทราบ') + '</span>'
          +     '</div>'
          +   '</div>'
          +   (acc.autoRespawn !== false ? '<span class="account-item__server-tag" style="background:var(--success-bg);color:var(--success-text);margin-right:8px;">Auto Respawn</span>' : '')
          +   '<span class="account-item__server-tag">' + escapeHtml(acc.targetServer) + '</span>'
          + '</div>'
          + '<div style="display:flex; align-items:center; gap:12px;">'
          +   '<label style="display:flex; align-items:center; gap:6px; cursor:pointer; font-size:12px; color:#9ca3af;">'
          +     '<input type="checkbox" ' + (acc.enabled ? 'checked' : '') + ' onchange="toggleAccount(' + acc.index + ')" style="accent-color:#6366f1; width:16px; height:16px;"> เปิดใช้งาน'
          +   '</label>'
          +   '<button class="btn-delete-account" onclick="removeAccount(' + acc.index + ')" title="ลบบอท"><svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" viewBox="0 0 24 24" style="vertical-align:-1px;margin-right:3px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>ลบ</button>'
          + '</div>'
          + '</div>';
      }).join('');
    }

    async function toggleAccount(index) {
      try {
        const res = await fetch('/api/accounts/' + index + '/toggle', { method: 'POST' });
        const data = await res.json();
        if (!data.success) {
          showToast(data.message, 'error');
          loadAccounts();
        }
      } catch (err) {
        showToast('ข้อผิดพลาด: ' + err.message, 'error');
        loadAccounts();
      }
    }

    async function addAccount() {
      const name = document.getElementById('accName').value.trim();
      const password = document.getElementById('accPassword').value.trim();
      const pin = document.getElementById('accPin').value.trim();
      const targetServer = document.getElementById('accTargetServer').value;
      const autoRespawn = document.getElementById('accAutoRespawn').checked;

      if (!name || !password || !pin) {
        showToast('กรุณากรอกข้อมูลให้ครบทุกช่อง', 'error');
        return;
      }

      try {
        const res = await fetch('/api/accounts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name, password: password, pin: pin, targetServer: targetServer, autoRespawn: autoRespawn }),
        });
        const data = await res.json();
        showToast(data.message, data.success ? 'success' : 'error');
        if (data.success) {
          document.getElementById('accName').value = '';
          document.getElementById('accPassword').value = '';
          document.getElementById('accPin').value = '';
          loadAccounts();
        }
      } catch (err) {
        showToast('ข้อผิดพลาด: ' + err.message, 'error');
      }
    }

    async function removeAccount(index) {
      if (!confirm('ต้องการลบบอทนี้ใช่หรือไม่?')) return;

      try {
        const res = await fetch('/api/accounts/' + index, { method: 'DELETE' });
        const data = await res.json();
        showToast(data.message, data.success ? 'success' : 'error');
        if (data.success) loadAccounts();
      } catch (err) {
        showToast('ข้อผิดพลาด: ' + err.message, 'error');
      }
    }

    async function fetchStatus() {
      try {
        const [statusRes, logsRes] = await Promise.all([
          fetch('/api/status'),
          fetch('/api/logs'),
        ]);
        const data = await statusRes.json();
        const logsData = await logsRes.json();
        renderBots(data);
        renderLogs(logsData.logs || []);

        if (data.serverHost) {
          document.getElementById('tagHost').textContent = data.serverHost;
          document.getElementById('tagVersion').textContent = data.serverVersion;
          document.getElementById('headerSubtitle').textContent = data.serverHost + ' • Minecraft ' + data.serverVersion;
        }
      } catch (err) {

      }
    }

    async function loadConfig() {
      try {
        const res = await fetch('/api/config');
        const data = await res.json();
        if (data.serverHost) {
          document.getElementById('inputHost').value = data.serverHost;
          document.getElementById('inputVersion').value = data.serverVersion;
          document.getElementById('inputAutoReconnect').checked = data.autoReconnect;
          document.getElementById('inputReconnectDelay').value = data.reconnectDelay / 1000;
          document.getElementById('inputQueueDelay').value = data.queueDelay / 1000;
          document.getElementById('queueDelayDisplay').innerText = data.queueDelay / 1000;
          document.getElementById('tagReconnect').textContent = data.autoReconnect ? 'เปิด (' + (data.reconnectDelay/1000) + ' วิ)' : 'ปิด';
        }
      } catch (err) { }
    }

    setInterval(fetchStatus, 1000);
    fetchStatus();
    loadConfig();
    loadAccounts();
  </script>
</body>
</html>`;
}

app.listen(WEB_PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   [BOT]  Overmine AFK Bot System             ║');
  console.log('║   [WEB]  Dashboard: http://localhost:' + WEB_PORT + '      ║');
  console.log('║   [SRV]  Server: ' + SERVER_HOST + '          ║');
  console.log('║   [ACC]  Accounts: ' + accountList.length + ' bot(s) configured     ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
});
