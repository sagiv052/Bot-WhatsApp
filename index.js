const { Client, LocalAuth } = require('whatsapp-web.js');

// ============================================================
// ====== תצורת הבוט ======
// ============================================================
const CONFIG = {
    ADMINS: ['972501234567@c.us'], // ⬅️ עדכן את המספר שלך כאן (פורמט: קידומת+מספר@c.us)
    PREFIX: '!',
    
    // ====== הגדרות אנטי-ספאם ======
    SPAM: {
        MAX_MESSAGES: 5,        // מספר הודעות מקסימלי לפני אזהרה
        TIME_WINDOW: 20000,     // 20 שניות
        MUTE_DURATION: 60000,   // משך ההשתקה (60 שניות)
        WARN_MESSAGE: '⚠️ *אזהרה!* אתה שולח יותר מדי הודעות (5 ב-20 שניות). הושתקת ל-60 שניות!',
        KICK_MESSAGE: '🚫 *הוסרת מהקבוצה* על הצפה חוזרת!'
    }
};

// ============================================================
// ====== מערכת אנטי-ספאם ======
// ============================================================
const spamTracker = new Map(); // key: groupId_userId, value: { messages: [], warnings: 0, mutedUntil: 0 }

function checkSpam(userId, groupId) {
    const key = `${groupId}_${userId}`;
    const now = Date.now();
    
    if (!spamTracker.has(key)) {
        spamTracker.set(key, { messages: [], warnings: 0, mutedUntil: 0 });
    }
    
    const userData = spamTracker.get(key);
    
    // אם מושתק – מחזירים סטטוס מושתק
    if (userData.mutedUntil > now) {
        return { 
            isSpam: true, 
            isMuted: true, 
            remainingTime: Math.ceil((userData.mutedUntil - now) / 1000),
            warningCount: userData.warnings,
            shouldKick: userData.warnings >= 2
        };
    }
    
    // ניקוי הודעות ישנות (מחוץ לחלון הזמן)
    userData.messages = userData.messages.filter(time => now - time < CONFIG.SPAM.TIME_WINDOW);
    userData.messages.push(now); // הוספת ההודעה החדשה
    
    // בדיקה אם עבר את הסף
    if (userData.messages.length >= CONFIG.SPAM.MAX_MESSAGES) {
        userData.warnings += 1;
        userData.messages = []; // איפוס הספירה
        
        // השתקה
        userData.mutedUntil = now + CONFIG.SPAM.MUTE_DURATION;
        const shouldKick = userData.warnings >= 2;
        
        spamTracker.set(key, userData);
        
        return {
            isSpam: true,
            isMuted: true,
            remainingTime: Math.ceil((userData.mutedUntil - now) / 1000),
            warningCount: userData.warnings,
            shouldKick: shouldKick
        };
    }
    
    spamTracker.set(key, userData);
    return { isSpam: false };
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
    // מנסה לחלץ מהמנטיונים
    if (message.mentionedIds && message.mentionedIds.length > 0) {
        return message.mentionedIds[0];
    }
    // ניסיון לחלץ מספר מהטקסט (למשל @0521234567)
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

client.on('ready', () => {
    console.log('✅ הבוט מוכן!');
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
            
            if (spamCheck.isSpam && spamCheck.isMuted) {
                // מוחקים את ההודעה
                try {
                    await message.delete(true);
                    console.log(`🗑️ הודעה נמחקה מ-${senderId} (מושתק)`);
                } catch (e) {}
                
                // אם צריך להסיר – עושים זאת
                if (spamCheck.shouldKick) {
                    try {
                        await chat.removeParticipants([senderId]);
                        await message.reply(CONFIG.SPAM.KICK_MESSAGE);
                        console.log(`🚫 ${senderId} הוסר מהקבוצה על הצפה`);
                        // איפוס המוניטור אחרי ההסרה
                        spamTracker.delete(`${groupId}_${senderId}`);
                    } catch (error) {
                        console.error('❌ שגיאה בהסרה:', error);
                    }
                } else {
                    // שליחת הודעה פרטית למשתמש (אם רוצים)
                    try {
                        const contact = await message.getContact();
                        await contact.sendMessage(`🔇 *הושתקת ל-${spamCheck.remainingTime} שניות* על הצפה.`);
                    } catch (e) {}
                }
                return; // לא ממשיכים לשאר הפקודות
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
                `${prefix}how - מה איתך?\n\n` +
                `🔒 *ניהול קבוצות (אדמין בלבד):*\n` +
                `${prefix}close - סגירת הקבוצה\n` +
                `${prefix}open - פתיחת הקבוצה\n` +
                `${prefix}remove @שם - הסרת משתמש\n` +
                `${prefix}promote @שם - הפיכת משתמש לאדמין\n` +
                `${prefix}demote @שם - הורדת משתמש מאדמין\n` +
                `${prefix}invite - קישור הזמנה\n\n` +
                `🛡️ *ניהול ספאם (אדמין בלבד):*\n` +
                `${prefix}unmute @שם - ביטול השתקה\n` +
                `${prefix}spamstats - סטטיסטיקות ספאם\n` +
                `${prefix}clearspam - איפוס מוניטור ספאם`
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
        // ====== 3. תשובה להודעה רגילה (לא פקודה) ======
        // ============================================================
        if (!msgBody.startsWith(prefix) && !isAdmin(senderId)) {
            // תשובה אקראית (רק לעיתים רחוקות כדי לא להציף)
            if (Math.random() < 0.1) {
                await message.reply('🤖 אני בוט. שלח !help לרשימת פקודות.');
            }
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
client.initialize();
