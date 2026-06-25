const groupId = chat.id._serialized;
            const spamCheck = checkSpam(senderId, groupId);
            
            if (spamCheck.isSpam) {
                await message.reply(spamCheck.message);
                
                if (spamCheck.shouldKick) {
                    try {
                        await chat.removeParticipants([senderId]);
                        console.log(🚫 ${senderId} הוסר מהקבוצה (3 אזהרות));
                        
                        try {
                            const contact = await message.getContact();
                            await contact.sendMessage(
                                🚫 *הוסרת מהקבוצה*\n\n +
                                קיבלת 3 אזהרות על הצפה בקבוצה והוסרת אוטומטית.\n +
                                📌 כדי לחזור, פנה לאחד המנהלים:\n +
                                ${CONFIG.ADMINS.join('\n')}
                            );
                            console.log(📩 נשלחה הודעה פרטית ל-${senderId});
                        } catch (e) {
                            console.error('❌ שגיאה בשליחת הודעה פרטית:', e);
                        }
                        
                        warningTracker.delete(${groupId}_${senderId});
                    } catch (error) {
                        console.error('❌ שגיאה בהסרה:', error);
                        await message.reply('❌ שגיאה בהרחקת המשתמש. וודא שהבוט הוא אדמין בקבוצה.');
                    }
                }
                return;
            }
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

// תיקון הלוגים השבורים שהיו בסוף הקוד
console.log('🚀 מפעיל את הבוט...');
console.log('🛡️ מערכת אזהרות מופעלת:');
console.log(   📌 ${CONFIG.SPAM.MAX_MESSAGES} הודעות ב-${CONFIG.SPAM.TIME_WINDOW/1000} שניות → אזהרה);
console.log(   ⚠️ ${CONFIG.SPAM.MAX_WARNINGS} אזהרות → הרחקה אוטומטית);
console.log(   👥 מנהלים (הבוט לא מגיב אליהם): ${CONFIG.ADMINS.join(', ')});
console.log('   💬 הבוט לא מגיב לאף משתמש (רק מטפל בספאם)');

client.initialize();
