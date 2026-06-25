const { Client, LocalAuth } = require('whatsapp-web.js');
const fs = require('fs');
const https = require('https');

// ============================================================
// ====== תצורת הבוט ======
// ============================================================
const CONFIG = {
    TXT_URL: 'https://drive.google.com/uc?export=download&id=הקוד_של_הקובץ',
    ADMINS: ['972501234567@c.us'],
    PREFIX: '!',
    
    // ====== הגדרות אנטי-ספאם ======
    SPAM: {
        MAX_MESSAGES: 5,        // מספר הודעות מקסימלי
        TIME_WINDOW: 20000,     // 20 שניות
        WARN_MESSAGE: '⚠️ *אזהרה!* אתה שולח יותר מדי הודעות (5 הודעות ב-20 שניות). אנא האט!',
        KICK_MESSAGE: '🚫 *הוסרת מהקבוצה* על הצפה חוזרת!',
        MUTE_DURATION: 60000,   // דקה של השתקה לאחר אזהרה
        BAN_DURATION: 300000    // 5 דקות הרחקה לאחר הסרה
    }
};

// ============================================================
// ====== מערכת אנטי-ספאם ======
// ============================================================
const spamTracker = new Map(); // key: userId, value: { messages: [], warnings: 0, mutedUntil: 0 }

function checkSpam(userId, groupId) {
    const key = `${groupId}_${userId}`;
    const now = Date.now();
    
    if (!spamTracker.has(key)) {
        spamTracker.set(key, { messages: [], warnings: 0, mutedUntil: 0 });
    }
    
    const userData = spamTracker.get(key);
    
    // בדיקה אם מושתק
    if (userData.mutedUntil > now) {
        return { isSpam: true, isMuted: true, remainingTime: Math.ceil((userData.mutedUntil - now) / 1000) };
    }
    
    // ניקוי הודעות ישנות
    userData.messages = userData.messages.filter(time => now - time < CONFIG.SPAM.TIME_WINDOW);
    
    // הוספת ההודעה החדשה
    userData.messages.push(now);
    
    // בדיקת כמות הודעות
    if (userData.messages.length >= CONFIG.SPAM.MAX_MESSAGES) {
        userData.warnings += 1;
        userData.messages = []; // איפוס הספירה
        
        // השתקת המשתמש
        userData.mutedUntil = now + CONFIG.SPAM.MUTE_DURATION;
        
        // אם זו אזהרה שנייה - סימון להסרה
        const shouldKick = userData.warnings >= 2;
        
        spamTracker.set(key, userData);
        
        return { 
            isSpam: true, 
            warningCount: userData.warnings,
            shouldKick: shouldKick,
            isMuted: true,
            remainingTime: Math.ceil((userData.mutedUntil - now) / 1000)
        };
    }
    
    spamTracker.set(key, userData);
    return { isSpam: false };
}

// ============================================================
// ====== קריאת קובץ מ-Google Drive ======
// ============================================================
let cachedData = [];
let lastFetchTime = 0;
const CACHE_TTL = 5 * 60 * 1000;

function fetchTxtFromDrive(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (response) => {
            let data = '';
            response.on('data', chunk => data += chunk);
            response.on('end', () => {
                const lines = data.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                resolve(lines);
            });
        }).on('error', reject);
    });
}

async function getTxtData(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && (now - lastFetchTime) < CACHE_TTL && cachedData.length > 0) {
        return cachedData;
    }
    try {
        cachedData = await fetchTxtFromDrive(CONFIG.TXT_URL);
        lastFetchTime = now;
        return cachedData;
    } catch (error) {
        return cachedData.length > 0 ? cachedData : ['❌ לא ניתן לטעון את הקובץ'];
    }
}

// ============================================================
// ====== פונקציות עזר ======
// ============================================================
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

// ============================================================
// ====== אתחול הבוט ======
// ============================================================
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// ============================================================
// ====== אירועי הבוט ======
// ============================================================
client.on('qr', (qr) => {
    console.log('📱 סרוק את הקוד QR:');
    console.log(qr);
});

client.on('ready', async () => {
    console.log('✅ הבוט מוכן!');
    await getTxtData(true);
    console.log('📄 המידע מהקובץ נטען');
    console.log('🛡️ מערכת אנטי-ספאם פעילה!');
});

client.on('message', async (message) => {
    try {
        if (!message.body) return;
        
        const chat = await message.getChat();
        const msgBody = message.body.trim();
        const senderId = message.author || message.from;
        const prefix = CONFIG.PREFIX;
        
        // ============================================================
        // ====== 0. בדיקת אנטי-ספאם (רק בקבוצות, לא לאדמינים) ======
        // ============================================================
        if (isGroupChat(chat) && !isAdmin(senderId) && !msgBody.startsWith(prefix)) {
            const groupId = chat.id._serialized;
            const spamCheck = checkSpam(senderId, groupId);
            
            if (spamCheck.isSpam) {
                // אם מושתק - מוחקים את ההודעה
                if (spamCheck.isMuted) {
                    try {
                        await message.delete(true);
                        console.log(`🗑️ הודעה נמחקה מ-${senderId} (מושתק)`);
                    } catch (e) {}
                    
                    // שליחת הודעה פרטית למשתמש
                    try {
                        const contact = await message.getContact();
                        await contact.sendMessage(`🔇 *הושתקת ל-${spamCheck.remainingTime} שניות* על הצפה.`);
                    } catch (e) {}
                    
                    return; // לא ממשיכים לשאר הפקודות
                }
                
                // אם צריך להסיר - מוציאים מהקבוצה
                if (spamCheck.shouldKick) {
                    try {
                        await chat.removeParticipants([senderId]);
                        await message.reply(CONFIG.SPAM.KICK_MESSAGE);
                        console.log(`🚫 ${senderId} הוסר מהקבוצה על הצפה`);
                        
                        // איפוס הסטטוס
                        const key = `${groupId}_${senderId}`;
                        spamTracker.delete(key);
                    } catch (error) {
                        console.error('❌ שגיאה בהסרה:', error);
                    }
                    return;
                }
                
                // אזהרה ראשונה
                await message.reply(CONFIG.SPAM.WARN_MESSAGE);
                try {
                    const contact = await message.getContact();
                    await contact.sendMessage(`⚠️ *אזהרה ראשונה!* הושתקת ל-${spamCheck.remainingTime} שניות. אזהרה נוספת = הסרה מהקבוצה.`);
                } catch (e) {}
                
                // מחק את ההודעות האחרונות של המשתמש
                try {
                    await message.delete(true);
                } catch (e) {}
                
                return;
            }
        }
        
        // ============================================================
        // ====== 1. פקודות בסיסיות ======
        // ============================================================
        if (msgBody === `${prefix}help`) {
            await message.reply(
                `📋 *פקודות זמינות:*\n\n` +
                `${prefix}help - עזרה\n` +
                `${prefix}hi - שלום\n` +
                `${prefix}how - מה איתך?\n` +
                `${prefix}close - סגירת הקבוצה (🔒 אדמין)\n` +
                `${prefix}open - פתיחת הקבוצה (🔓 אדמין)\n` +
                `${prefix}remove @שם - הסרת משתמש (אדמין)\n` +
                `${prefix}promote @שם - הפיכת משתמש לאדמין (אדמין)\n` +
                `${prefix}demote @שם - הורדת משתמש מאדמין (אדמין)\n` +
                `${prefix}invite - קישור הזמנה (אדמין)\n` +
                `${prefix}search [מילה] - חיפוש בקובץ\n` +
                `${prefix}all - הצגת כל הקובץ\n` +
                `${prefix}unmute @שם - ביטול השתקה (אדמין)\n` +
                `${prefix}spamstats - סטטיסטיקות ספאם (אדמין)\n` +
                `${prefix}clearspam - איפוס מוניטור ספאם (אדמין)`
            );
            return;
        }
        
        if (msgBody === `${prefix}hi`) {
            await message.reply('👋 היי! מה נשמע?');
            return;
        }
        
        if (msgBody === `${prefix}how`) {
            await message.reply('😊 אני בסדר תודה! איך אתה?');
            return;
        }
        
        // ============================================================
        // ====== 2. ניהול קבוצות (אדמין בלבד) ======
        // ============================================================
        
        // 2.1 סגירת/פתיחת קבוצה
        if (msgBody === `${prefix}close` || msgBody === `${prefix}open`) {
            if (!isGroupChat(chat)) {
                await message.reply('⚠️ הפקודה הזו עובדת רק בקבוצות.');
                return;
            }
            if (!isAdmin(senderId)) {
                await message.reply('⛔ רק אדמין יכול לבצע פעולה זו!');
                return;
            }
            
            const isClosing = msgBody === `${prefix}close`;
            await chat.setMessagesAdminsOnly(isClosing);
            await message.reply(`✅ הקבוצה ${isClosing ? '🔒 נסגרה' : '🔓 נפתחה'}. ${isClosing ? 'רק אדמינים יכולים לשלוח.' : 'כולם יכולים לשלוח.'}`);
            return;
        }
        
        // 2.2 הסרת משתמש
        if (msgBody.startsWith(`${prefix}remove`)) {
            if (!isGroupChat(chat)) {
                await message.reply('⚠️ הפקודה הזו עובדת רק בקבוצות.');
                return;
            }
            if (!isAdmin(senderId)) {
                await message.reply('⛔ רק אדמין יכול להסיר משתמשים!');
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
                // ניקוי מהמוניטור
                const groupId = chat.id._serialized;
                spamTracker.delete(`${groupId}_${targetId}`);
            } catch (error) {
                await message.reply(`❌ שגיאה בהסרה: ${error.message}`);
            }
            return;
        }
        
        // 2.3 הפיכת משתמש לאדמין
        if (msgBody.startsWith(`${prefix}promote`)) {
            if (!isGroupChat(chat)) {
                await message.reply('⚠️ הפקודה הזו עובדת רק בקבוצות.');
                return;
            }
            if (!isAdmin(senderId)) {
                await message.reply('⛔ רק אדמין יכול לבצע פעולה זו!');
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
        
        // 2.4 הורדת משתמש מאדמין
        if (msgBody.startsWith(`${prefix}demote`)) {
            if (!isGroupChat(chat)) {
                await message.reply('⚠️ הפקודה הזו עובדת רק בקבוצות.');
                return;
            }
            if (!isAdmin(senderId)) {
                await message.reply('⛔ רק אדמין יכול לבצע פעולה זו!');
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
        
        // 2.5 קישור הזמנה
        if (msgBody === `${prefix}invite`) {
            if (!isGroupChat(chat)) {
                await message.reply('⚠️ הפקודה הזו עובדת רק בקבוצות.');
                return;
            }
            if (!isAdmin(senderId)) {
                await message.reply('⛔ רק אדמין יכול לקבל קישור הזמנה!');
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
        
        // 2.6 ביטול השתקה (אדמין)
        if (msgBody.startsWith(`${prefix}unmute`)) {
            if (!isGroupChat(chat)) {
                await message.reply('⚠️ הפקודה הזו עובדת רק בקבוצות.');
                return;
            }
            if (!isAdmin(senderId)) {
                await message.reply('⛔ רק אדמין יכול לבטל השתקה!');
                return;
            }
            
            const targetId = extractMentionedUser(message);
            if (!targetId) {
                await message.reply('⚠️ יש לציין משתמש. דוגמה: !unmute @0521234567');
                return;
            }
            
            const groupId = chat.id._serialized;
            const key = `${groupId}_${targetId}`;
            if (spamTracker.has(key)) {
                const data = spamTracker.get(key);
                data.mutedUntil = 0;
                data.messages = [];
                spamTracker.set(key, data);
                await message.reply(`✅ המשתמש הוצא מהשתקה.`);
            } else {
                await message.reply(`❌ המשתמש לא נמצא במוניטור.`);
            }
            return;
        }
        
        // 2.7 סטטיסטיקות ספאם
        if (msgBody === `${prefix}spamstats`) {
            if (!isAdmin(senderId)) {
                await message.reply('⛔ רק אדמין יכול לראות סטטיסטיקות!');
                return;
            }
            
            let stats = `📊 *סטטיסטיקות אנטי-ספאם*\n\n`;
            let totalUsers = 0;
            let totalWarnings = 0;
            let mutedUsers = 0;
            
            for (const [key, data] of spamTracker) {
                totalUsers++;
                totalWarnings += data.warnings;
                if (data.mutedUntil > Date.now()) mutedUsers++;
            }
            
            stats += `👥 משתמשים במעקב: ${totalUsers}\n`;
            stats += `⚠️ סך אזהרות: ${totalWarnings}\n`;
            stats += `🔇 מושתקים כעת: ${mutedUsers}\n`;
            stats += `⚙️ סף אזהרה: ${CONFIG.SPAM.MAX_MESSAGES} הודעות ב-${CONFIG.SPAM.TIME_WINDOW/1000} שניות`;
            
            await message.reply(stats);
            return;
        }
        
        // 2.8 איפוס מוניטור
        if (msgBody === `${prefix}clearspam`) {
            if (!isAdmin(senderId)) {
                await message.reply('⛔ רק אדמין יכול לאפס את המוניטור!');
                return;
            }
            
            spamTracker.clear();
            await message.reply('✅ כל נתוני הספאם אופסו.');
            return;
        }
        
        // ============================================================
        // ====== 3. חיפוש בקובץ ======
        // ============================================================
        if (msgBody.startsWith(`${prefix}search `)) {
            const keyword = msgBody.slice(`${prefix}search `.length).trim();
            if (!keyword) {
                await message.reply('⚠️ יש להזין מילת חיפוש. דוגמה: !search שלום');
                return;
            }
            
            const data = await getTxtData();
            const results = data.filter(line => line.toLowerCase().includes(keyword.toLowerCase()));
            
            if (results.length === 0) {
                await message.reply(`❌ לא נמצא מידע עבור: "${keyword}"`);
            } else {
                const response = `🔍 *תוצאות חיפוש עבור "${keyword}":*\n\n` + results.slice(0, 5).join('\n');
                await message.reply(response.slice(0, 4096));
            }
            return;
        }
        
        if (msgBody === `${prefix}all`) {
            const data = await getTxtData();
            const response = `📄 *כל המידע מהקובץ:*\n\n` + data.join('\n');
            await message.reply(response.slice(0, 4096));
            return;
        }
        
    } catch (error) {
        console.error('❌ שגיאה:', error);
        try {
            await message.reply('❌ אירעה שגיאה, נסה שוב.');
        } catch (e) {}
    }
});

// ============================================================
// ====== הרצת הבוט ======
// ============================================================
process.on('SIGINT', async () => {
    console.log('🛑 סוגר את הבוט...');
    await client.destroy();
    process.exit(0);
});

console.log('🚀 מפעיל את הבוט...');
console.log('🛡️ מערכת אנטי-ספאם מופעלת:');
console.log(`   📌 ${CONFIG.SPAM.MAX_MESSAGES} הודעות ב-${CONFIG.SPAM.TIME_WINDOW/1000} שניות`);
console.log(`   ⚠️ אזהרה → השתקה ל-${CONFIG.SPAM.MUTE_DURATION/1000} שניות`);
console.log(`   🚫 אזהרה שנייה → הסרה מהקבוצה`);
client.initialize(); זה הכוונה איפה לעלות את זה ואיזה שם לתת לזה
