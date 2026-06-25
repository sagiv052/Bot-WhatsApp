const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

// ============================================================
// ====== תצורת הבוט ======
// ============================================================
const CONFIG = {
    ADMINS: [
        '972502206606@c.us', 
        '972532796337@c.us', 
        '972537666983@c.us',
        '972547654321@c.us'   // איתי - תעדכן את הספרות
    ],
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

// ====== פונקציית isAdmin מתוקנת ======
function isAdmin(contactId) {
    // מסיר את @c.us ומשווה
    const cleanId = contactId.replace('@c.us', '');
    for (const admin of CONFIG.ADMINS) {
        const cleanAdmin = admin.replace('@c.us', '');
        if (cleanId === cleanAdmin) {
            return true;
        }
    }
    return false;
}

function isGroupChat(chat) {
    return chat.isGroup;
}

function extractMentionedUser(message) {
    if (message.mentionedIds && message.mentionedIds.length > 0
