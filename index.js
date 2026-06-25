const { Client, LocalAuth } = require('whatsapp-web.js');

// ============================================================
// ====== תצורת הבוט ======
// ============================================================
const CONFIG = {
    ADMINS: ['972502206606@c.us', '972532796337@c.us'], // שני המנהלים
    PREFIX: '!',
    
    // ====== הגדרות אזהרות וספאם ======
    SPAM: {
        MAX_MESSAGES: 5,           // מספר הודעות מקסימלי לפני אזהרה
        TIME_WINDOW: 20000,        // 20 שניות
        MAX_WARNINGS: 3,           // 3 אזהרות ואז הרחקה
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
const warningTracker = new Map(); // key: groupId_userId, value: { messages: [], warnings: 0 }

function checkSpam(userId, groupId) {
    const key = `${groupId}_${userId}`;
    const now = Date.now();
    
    if (!warningTracker.has(key)) {
        warningTracker.set(key, { messages: [], warnings: 0 });
    }
    
    const userData = warningTracker.get(key);
    
    // ניקוי הודעות ישנות
    userData.messages = userData.messages.filter(time => now - time < CONFIG.SPAM.TIME_WINDOW);
    userData.messages.push(now);
    
    // בדיקה אם עבר את הסף
    if (userData.messages.length >= CONFIG.SPAM.MAX_MESSAGES) {
        userData.warnings += 1;
        userData.messages = []; // איפוס הספירה
        
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
        // ====== 1. התעלמות מוחלטת ממנהלים ======
        // ============================================================
        if (isAdmin(senderId)) {
            return; // מנהלים - הבוט לא עושה כלום
        }
        
        // ============================================================
        // ====== 2. בדיקת ספאם (רק בקבוצות) ======
        // ============================================================
        if (isGroupChat(chat) && !msgBody.startsWith(prefix)) {
            const groupId = chat.id._serialized;
            const spamCheck = checkSpam(senderId, groupId);
            
            if (spamCheck.isSpam) {
                // שליחת אזהרה בצ'אט
                await message.reply(spamCheck.message);
                
                // אם צריך להסיר - עושים זאת
                if (spamCheck.shouldKick) {
                    try {
                        // הסרה מהקבוצה
                        await chat.removeParticipants([senderId]);
                        console.log(`🚫 ${senderId} הוסר מהקבוצה (3 אזהרות)`);
                        
                        // שליחת הודעה פרטית למשתמש
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
                        
                        // איפוס המוניטור אחרי ההסרה
                        warningTracker.delete(`${groupId}_${senderId}`);
                    } catch (error) {
                        console.error('❌ שגיאה בהסרה:', error);
                        await message.reply('❌ שגיאה בהרחקת המשתמש. וודא שהבוט הוא אדמין בקבוצה.');
                    }
                }
                return; // לא ממשיכים לפקודות
            }
        }
        
        // ============================================================
        // ====== 3. פקודות בסיסיות (רק למנהלים!) ======
        // ============================================================
        // (כבר טיפלנו במנהלים ב-return, אז הם לא מגיעים לכאן)
        // ============================================================
        // ====== 4. תגובה אוטומטית ======
        // ============================================================
        // בלי שום תגובה אוטומטית (בהתאם לדרישה)
        
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
console.log('🛡️ מערכת אזהרות מופעלת:');
console.log(`   📌 ${CONFIG.SPAM.MAX_MESSAGES} הודעות ב-${CONFIG.SPAM.TIME_WINDOW/1000} שניות → אזהרה`);
console.log(`   ⚠️ ${CONFIG.SPAM.MAX_WARNINGS} אזהרות → הרחקה אוטומטית`);
console.log(`   👥 מנהלים (הבוט לא מגיב אליהם): ${CONFIG.ADMINS.join(', ')}`);
console.log('   💬 הבוט לא מגיב לאף משתמש (רק מטפל בספאם)');
client.initialize();
