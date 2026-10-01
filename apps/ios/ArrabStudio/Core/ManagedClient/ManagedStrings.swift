import Foundation

/// Every managed-client string in English and Arabic.
enum ManagedStrings {
  enum Key: CaseIterable {
    case open, updateNow, blockingTitle, blockingBody, readChats, signOut, updateRequiredBar
    case softTitle, later, readOnlyDefault, backAt, dismiss, companionUnavailable
    case notifications, notificationsEmpty, markAllRead, usageWarn, usageBlocked, upgrade
    case privacyTitle, privacyDisclosure, logsTitle, logsBody, logsShare, logsDecline, ok
    case readOnlySend, badgeNew, badgeBeta
    case usageFullTitle, usageFullBody, addCredit, managePlan
    case approvalNoticeTitle, approvalNoticeBody, approve, notNow
  }

  static func t(_ key: Key, arabic: Bool) -> String {
    (arabic ? ar[key] : en[key]) ?? en[key] ?? ""
  }

  static let en: [Key: String] = [
    .open: "Open",
    .updateNow: "Update now",
    .blockingTitle: "Update required",
    .blockingBody: "This version of Arrab is no longer supported. Update to keep chatting.",
    .readChats: "Read my chats",
    .signOut: "Sign out",
    .updateRequiredBar: "Update required to send messages.",
    .softTitle: "A new version of Arrab is ready.",
    .later: "Later",
    .readOnlyDefault: "Arrab is in maintenance. You can read, but sending is paused.",
    .backAt: "Back at {time}",
    .dismiss: "Dismiss",
    .companionUnavailable: "This companion is temporarily unavailable",
    .notifications: "Notifications",
    .notificationsEmpty: "You’re all caught up.",
    .markAllRead: "Mark all read",
    .usageWarn: "You’ve used {pct}% of your plan.",
    .usageBlocked: "You’ve reached your plan limit. It resets {time}.",
    .upgrade: "Upgrade",
    .privacyTitle: "Device status",
    .privacyDisclosure: "Arrab reports app version, device type and online status to keep your app updated and secure.",
    .logsTitle: "Share diagnostics?",
    .logsBody: "Arrab support asked for app diagnostics: versions, sync status and error codes. No messages, prompts or files are included.",
    .logsShare: "Share",
    .logsDecline: "Not now",
    .ok: "OK",
    .readOnlySend: "Sending is paused during maintenance.",
    .badgeNew: "New",
    .badgeBeta: "Beta",
    .usageFullTitle: "Usage is full",
    .usageFullBody: "You’ve used 100% of this period. Add credit, or wait until it resets.",
    .addCredit: "Add credit",
    .managePlan: "Manage plan",
    .approvalNoticeTitle: "Approval needed",
    .approvalNoticeBody: "A companion is waiting for you.",
    .approve: "Approve",
    .notNow: "Not now",
  ]

  static let ar: [Key: String] = [
    .open: "فتح",
    .updateNow: "حدّث الآن",
    .blockingTitle: "التحديث مطلوب",
    .blockingBody: "هذا الإصدار من عرب لم يعد مدعومًا. حدّث التطبيق لتواصل المحادثة.",
    .readChats: "اقرأ محادثاتي",
    .signOut: "تسجيل الخروج",
    .updateRequiredBar: "التحديث مطلوب لإرسال الرسائل.",
    .softTitle: "إصدار جديد من عرب جاهز.",
    .later: "لاحقًا",
    .readOnlyDefault: "عرب في صيانة. يمكنك القراءة، لكن الإرسال متوقف مؤقتًا.",
    .backAt: "نعود الساعة {time}",
    .dismiss: "إغلاق",
    .companionUnavailable: "هذا الرفيق غير متاح مؤقتًا",
    .notifications: "الإشعارات",
    .notificationsEmpty: "لا جديد حاليًا.",
    .markAllRead: "تعليم الكل كمقروء",
    .usageWarn: "استخدمت {pct}% من باقتك.",
    .usageBlocked: "وصلت إلى حد باقتك. يتجدد {time}.",
    .upgrade: "ترقية",
    .privacyTitle: "حالة الجهاز",
    .privacyDisclosure: "يرسل عرب إصدار التطبيق ونوع الجهاز وحالة الاتصال للحفاظ على تحديث تطبيقك وأمانه.",
    .logsTitle: "مشاركة بيانات التشخيص؟",
    .logsBody: "طلب دعم عرب بيانات تشخيص التطبيق: الإصدارات وحالة المزامنة ورموز الأخطاء. لا تُرسل أي رسائل أو طلبات أو ملفات.",
    .logsShare: "مشاركة",
    .logsDecline: "ليس الآن",
    .ok: "حسنًا",
    .readOnlySend: "الإرسال متوقف مؤقتًا أثناء الصيانة.",
    .badgeNew: "جديد",
    .badgeBeta: "تجريبي",
    .usageFullTitle: "اكتمل الاستخدام",
    .usageFullBody: "استخدمت ١٠٠٪ من هذه الفترة. أضف رصيداً، أو انتظر حتى يتجدد.",
    .addCredit: "إضافة رصيد",
    .managePlan: "إدارة الباقة",
    .approvalNoticeTitle: "يلزم موافقة",
    .approvalNoticeBody: "رفيق بانتظارك.",
    .approve: "موافقة",
    .notNow: "ليس الآن",
  ]
}
