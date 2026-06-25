const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

// ============================================================
// ====== תצורת הבוט ======
// ============================================================
const CONFIG = {
    ADMINS: ['972502206606@c.us', '972532796337@c.us', '972537666983@c.us'],
    PREFIX: '!',
    
    SPAM: {
        MAX_MESSAGES: 5,
        TIME_WINDOW: 20000,
        MAX_WARNINGS: 3,
        WARN_MESSAGES: [
            '⚠️ *אזהרה ראשונה!* אתה שולח יותר מדי הודעות (5 ב-20 שניות). האט!',
            '⚠️ *אזהרה שנייה!* זו אזהרה אחרונה! הודעה נוספת = הרחקה מהקבוצה.',
            '⚠️ *אזהרה שלישית!* הוסרת מהקבוצה על הצפה חוזרת.'
        ],
        KICK_MESSAGE: '🚫 הוסרת מהקבוצה על הצפה חוזרת (3 אזהרות).'
    }
};

// ============================================================
// ====== מערכת אזהרות ======
// ============================================================
const warningTracker = new Map();

function checkSpam(userId, groupId) {
    const key = `${groupId}_${userId}`;
    const now = Date.now();
    
    if (!warningTracker.has(key)) {
        warningTracker.set(key, { messages: [], warnings: 0 });
    }
    
    const userData = warningTracker.get(key);
    userData.messages = userData.messages.filter(time => now - time < CONFIG.SPAM.TIME_WINDOW);
    userData.messages.push(now);
    
    if (userData.messages.length >= CONFIG.SPAM.MAX_MESSAGES) {
        userData.warnings += 1;
        userData.messages = [];
        const warnCount = userData.warnings;
        const shouldKick = warnCount >= CONFIG.SPAM.MAX_WARNINGS;
        warningTracker.set(key, userData);
        
        return {
            isSpam: true,
            warningCount: warnCount,
            shouldKick: shouldKick,
            message: CONFIG.SPAM.WARN_MESSAGES[Math.min(warnCount - 1, CONFIG.SPAM.WARN_MESSAGES.length - 1)]
        };
    }
    
    warningTracker.set(key, userData);
    return { isSpam: false };
}

function isAdmin(contactId) {
    return CONFIG.ADMINS.includes(contactId);
}

function isGroupChat(chat) {
    return chat.isGroup;
}

function extractMentionedUser(message) {
    if (message.mentionedIds && message.mentionedIds.length > 0) {
        return message.mentionedIds[0];
    }
    const match = message.body.match(/@?(\d{10,12})/);
    if (match) {
        return match[1] + '@c.us';
    }
    return null;
}

function getTime() {
    const now = new Date();
    return now.toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' });
}

// ============================================================
// ====== אתחול הבוט ======
// ============================================================
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        executablePath: '/data/data/com.termux/files/usr/bin/chromium-browser',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu',
            '--disable-features=IsolateOrigins,site-per-process',
            '--disable-blink-features=AutomationControlled',
            '--disable-background-networking',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-breakpad',
            '--disable-client-side-phishing-detection',
            '--disable-component-extensions-with-background-pages',
            '--disable-default-apps',
            '--disable-extensions',
            '--disable-hang-monitor',
            '--disable-ipc-flooding-protection',
            '--disable-popup-blocking',
            '--disable-prompt-on-repost',
            '--disable-renderer-backgrounding',
            '--disable-sync',
            '--force-color-profile=srgb'
        ]
    }
});

// ============================================================
// ====== אירועי הבוט ======
// ============================================================
client.on('qr', (qr) => {
    console.log('\n📱 סרוק את קוד ה-QR עם וואטסאפ:');
    qrcode.generate(qr, { small: true });
    console.log('\n⏳ ממתין לסריקה...\n');
});

client.on('authenticated', () => {
    console.log('🔐 הבוט אומת בהצלחה!');
});

client.on('auth_failure', (msg) => {
    console.error('❌ אימות נכשל:', msg);
});

client.on('ready', () => {
    console.log('✅ הבוט מוכן!');
    console.log('🛡️ מערכת אזהרות פעילה!');
    console.log(`👥 מנהלים: ${CONFIG.ADMINS.join(', ')}`);
});

client.on('message', async (message) => {
    try {
        if (!message.body) return;
        
        const chat = await message.getChat();
        const msgBody = message.body.trim();
        const senderId = message.author || message.from;
        const prefix = CONFIG.PREFIX;
        
        // ============================================================
        // ====== 1. אנטי-ספאם (רק בקבוצות, לא למנהלים) ======
        // ============================================================
        if (isGroupChat(chat) && !isAdmin(senderId) && !msgBody.startsWith(prefix)) {
            const groupId = chat.id._serialized;
            const spamCheck = checkSpam(senderId, groupId);
            
            if (spamCheck.isSpam) {
                await message.reply(spamCheck.message);
                
                if (spamCheck.shouldKick) {
                    try {
                        await chat.removeParticipants([senderId]);
                        console.log(`🚫 ${senderId} הוסר מהקבוצה (3 אזהרות)`);
                        
                        try {
                            const contact = await message.getContact();
                            await contact.sendMessage(
                                `🚫 *הוסרת מהקבוצה*\n\n` +
                                `קיבלת 3 אזהרות על הצפה בקבוצה והוסרת אוטומטית.\n` +
                                `📌 כדי לחזור, פנה לאחד המנהלים:\n` +
                                `${CONFIG.ADMINS.join('\n')}`
                            );
                            console.log(`📩 נשלחה הודעה פרטית ל-${senderId}`);
                        } catch (e) {
                            console.error('❌ שגיאה בשליחת הודעה פרטית:', e);
                        }
                        
                        warningTracker.delete(`${groupId}_${senderId}`);
                    } catch (error) {
                        console.error('❌ שגיאה בהסרה:', error);
                        await message.reply('❌ שגיאה בהרחקת המשתמש. וודא שהבוט הוא אדמין בקבוצה.');
                    }
                }
                return;
            }
        }
        
        // ============================================================
        // ====== 2. פקודות כלליות (לכולם) ======
        // ============================================================
        if (msgBody === `${prefix}help`) {
            await message.reply(
                `📋 *תפריט עזרה - הבוט החכם*\n\n` +
                `🔹 *פקודות כלליות:*\n` +
                `${prefix}help - תפריט עזרה\n` +
                `${prefix}hi - שלום 👋\n` +
                `${prefix}how - מה איתך?\n` +
                `${prefix}time - שעה נוכחית\n` +
                `${prefix}about - מידע על הבוט\n` +
                `${prefix}ping - בדיקת זמינות\n\n` +
                `🔸 *פקודות ניהול (למנהלים בלבד):*\n` +
                `${prefix}close - סגירת הקבוצה 🔒\n` +
                `${prefix}open - פתיחת הקבוצה 🔓\n` +
                `${prefix}remove @שם - הסרת משתמש\n` +
                `${prefix}promote @שם - הפיכת משתמש לאדמין\n` +
                `${prefix}demote @שם - הורדת משתמש מאדמין\n` +
                `${prefix}invite - קישור הזמנה לקבוצה\n` +
                `${prefix}spamstats - סטטיסטיקות ספאם\n` +
                `${prefix}clearspam - איפוס מוניטור ספאם`
            );
            return;
        }
        
        if (msgBody === `${prefix}hi`) {
            const responses = [
                '👋 היי! מה נשמע?',
                '🤗 שלום! איך עובר היום?',
                '😊 היי חבר! שמח לראות אותך.',
                '🌟 שלום! מה שלומך?'
            ];
            await message.reply(responses[Math.floor(Math.random() * responses.length)]);
            return;
        }
        
        if (msgBody === `${prefix}how`) {
            const responses = [
                '😊 אני בסדר תודה! איך אתה?',
                '🤖 אני מרגיש מעולה! מריץ הודעות כמו שצריך.',
                '💪 הכל טוב! בוט חזק ומתפקד.',
                '🌟 מצוין! תודה ששאלת.'
            ];
            await message.reply(responses[Math.floor(Math.random() * responses.length)]);
            return;
        }
        
        if (msgBody === `${prefix}time`) {
            await message.reply(`🕐 *שעה נוכחית:* ${getTime()}`);
            return;
        }
        
        if (msgBody === `${prefix}about`) {
            await message.reply(
                `🤖 *בוט ניהול חכם*\n\n` +
                `📌 *גרסה:* 2.0\n` +
                `🛡️ *אנטי-ספאם:* 5 הודעות ב-20 שניות → 3 אזהרות → הרחקה\n` +
                `👥 *מנהלים:* ${CONFIG.ADMINS.length} מוגדרים\n` +
                `🔒 *ניהול קבוצות:* סגירה/פתיחה/הסרה/קידום\n` +
                `📱 *פותח:* שגיב\n` +
                `⚡ *סטטוס:* פעיל ומתפקד!`
            );
            return;
        }
        
        if (msgBody === `${prefix}ping`) {
            const start = Date.now();
            await message.reply('🏓 Pong!');
            const end = Date.now();
            await message.reply(`⏱️ זמן תגובה: ${end - start}ms`);
            return;
        }
        
        // ============================================================
        // ====== 3. פקודות ניהול (למנהלים בלבד) ======
        // ============================================================
        if (!isAdmin(senderId)) {
            // אם המשתמש לא מנהל ושלח פקודה לא מוכרת
            if (msgBody.startsWith(prefix)) {
                await message.reply('❌ פקודה לא מוכרת או שאין לך הרשאה. שלח !help לתפריט.');
            }
            return;
        }
        
        // 3.1 סגירת/פתיחת קבוצה
        if (msgBody === `${prefix}close` || msgBody === `${prefix}open`) {
            if (!isGroupChat(chat)) {
                await message.reply('⚠️ הפקודה הזו עובדת רק בקבוצות.');
                return;
            }
            
            const isClosing = msgBody === `${prefix}close`;
            await chat.setMessagesAdminsOnly(isClosing);
            await message.reply(`✅ הקבוצה ${isClosing ? '🔒 נסגרה' : '🔓 נפתחה'}. ${isClosing ? 'רק אדמינים יכולים לשלוח.' : 'כולם יכולים לשלוח.'}`);
            return;
        }
        
        // 3.2 הסרת משתמש
        if (msgBody.startsWith(`${prefix}remove`)) {
            if (!isGroupChat(chat)) {
                await message.reply('⚠️ הפקודה הזו עובדת רק בקבוצות.');
                return;
            }
            
            const targetId = extractMentionedUser(message);
            if (!targetId) {
                await message.reply('⚠️ יש לציין משתמש להסרה. דוגמה: !remove @0521234567');
                return;
            }
            
            try {
                await chat.removeParticipants([targetId]);
                await message.reply(`✅ המשתמש הוסר מהקבוצה.`);
                const groupId = chat.id._serialized;
                warningTracker.delete(`${groupId}_${targetId}`);
            } catch (error) {
                await message.reply(`❌ שגיאה בהסרה: ${error.message}`);
            }
            return;
        }
        
        // 3.3 הפיכת משתמש לאדמין
        if (msgBody.startsWith(`${prefix}promote`)) {
            if (!isGroupChat(chat)) {
                await message.reply('⚠️ הפקודה הזו עובדת רק בקבוצות.');
                return;
            }
            
            const targetId = extractMentionedUser(message);
            if (!targetId) {
                await message.reply('⚠️ יש לציין משתמש לקידום. דוגמה: !promote @0521234567');
                return;
            }
            
            try {
                await chat.promoteParticipants([targetId]);
                await message.reply(`✅ המשתמש הפך לאדמין.`);
            } catch (error) {
                await message.reply(`❌ שגיאה בקידום: ${error.message}`);
            }
            return;
        }
        
        // 3.4 הורדת משתמש מאדמין
        if (msgBody.startsWith(`${prefix}demote`)) {
            if (!isGroupChat(chat)) {
                await message.reply('⚠️ הפקודה הזו עובדת רק בקבוצות.');
                return;
            }
            
            const targetId = extractMentionedUser(message);
            if (!targetId) {
                await message.reply('⚠️ יש לציין משתמש להורדה. דוגמה: !demote @0521234567');
                return;
            }
            
            try {
                await chat.demoteParticipants([targetId]);
                await message.reply(`✅ המשתמש הורד מאדמין.`);
            } catch (error) {
                await message.reply(`❌ שגיאה בהורדה: ${error.message}`);
            }
            return;
        }
        
        // 3.5 קישור הזמנה
        if (msgBody === `${prefix}invite`) {
            if (!isGroupChat(chat)) {
                await message.reply('⚠️ הפקודה הזו עובדת רק בקבוצות.');
                return;
            }
            
            try {
                const inviteCode = await chat.getInviteCode();
                const inviteLink = `https://chat.whatsapp.com/${inviteCode}`;
                await message.reply(`🔗 *קישור הזמנה:*\n${inviteLink}`);
            } catch (error) {
                await message.reply(`❌ שגיאה ביצירת קישור: ${error.message}`);
            }
            return;
        }
        
        // 3.6 סטטיסטיקות ספאם
        if (msgBody === `${prefix}spamstats`) {
            let stats = `📊 *סטטיסטיקות אנטי-ספאם*\n\n`;
            let totalUsers = 0;
            let totalWarnings = 0;
            
            for (const [, data] of warningTracker) {
                totalUsers++;
                totalWarnings += data.warnings;
            }
            
            stats += `👥 משתמשים במעקב: ${totalUsers}\n`;
            stats += `⚠️ סך אזהרות: ${totalWarnings}\n`;
            stats += `⚙️ סף אזהרה: ${CONFIG.SPAM.MAX_MESSAGES} הודעות ב-${CONFIG.SPAM.TIME_WINDOW/1000} שניות`;
            stats += `\n🔢 אזהרות להרחקה: ${CONFIG.SPAM.MAX_WARNINGS}`;
            
            await message.reply(stats);
            return;
        }
        
        // 3.7 איפוס מוניטור ספאם
        if (msgBody === `${prefix}clearspam`) {
            warningTracker.clear();
            await message.reply('✅ כל נתוני הספאם אופסו.');
            return;
        }
        
        // 3.8 פקודה לא מוכרת למנהל
        if (msgBody.startsWith(prefix)) {
            await message.reply('❌ פקודה לא מוכרת. שלח !help לתפריט.');
        }
        
    } catch (error) {
        console.error('❌ שגיאה:', error);
        try {
            await message.reply('❌ אירעה שגיאה, נסה שוב.');
        } catch (e) {}
    }
});

process.on('SIGINT', async () => {
    console.log('🛑 סוגר את הבוט...');
    await client.destroy();
    process.exit(0);
});

console.log('🚀 מפעיל את הבוט...');
console.log('🛡️ מערכת אזהרות מופעלת:');
console.log(`   📌 ${CONFIG.SPAM.MAX_MESSAGES} הודעות ב-${CONFIG.SPAM.TIME_WINDOW/1000} שניות → אזהרה`);
console.log(`   ⚠️ ${CONFIG.SPAM.MAX_WARNINGS} אזהרות → הרחקה אוטומטית`);
console.log(`   👥 מנהלים: ${CONFIG.ADMINS.join(', ')}`);
client.initialize();
