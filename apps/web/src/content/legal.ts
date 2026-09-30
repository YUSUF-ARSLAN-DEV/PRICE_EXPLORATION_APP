/**
 * Public legal/help page bodies. DRAFTS condensed from docs/legal/*.md - NOT reviewed by counsel
 * (plan step 0.5). Placeholders in [BRACKETS] must be replaced before launch. The Arabic text is an
 * unreviewed draft translation and needs a certified legal translator.
 */
export interface Section {
  h: string;
  p: string[];
}
export type PageKey = 'terms' | 'privacy' | 'cookies' | 'about';
type Bodies = Record<PageKey, { title: string; sections: Section[] }>;

const en: Bodies = {
  terms: {
    title: 'Terms of Use',
    sections: [
      {
        h: 'Operator',
        p: [
          '[COMPANY NAME], Commercial Registration [CR NUMBER], [ADDRESS], Qatar. Contact: [LEGAL EMAIL].',
        ],
      },
      {
        h: 'The service',
        p: [
          'Qarib is an information service that compares grocery prices. We do not sell groceries; purchases are made with the retailer.',
        ],
      },
      {
        h: 'Price accuracy',
        p: [
          'Prices, offers and availability come from retailers, partners and community contributors and can change at any time. Each price shows when it was last updated. Always check the price at the store or checkout. We do not guarantee accuracy or completeness.',
        ],
      },
      {
        h: 'No affiliation',
        p: [
          'Retailer names are used only to identify them. We are not endorsed by them unless stated.',
        ],
      },
      {
        h: 'Eligibility and accounts',
        p: [
          'You must be 18 or older. Keep your credentials safe; you are responsible for activity on your account.',
        ],
      },
      {
        h: 'Acceptable use',
        p: [
          'No automated access to our service without permission, no attempts to breach security, and no unlawful, defamatory or misleading content, or content contrary to public morals or Islamic values.',
        ],
      },
      {
        h: 'Community contributions',
        p: [
          'You grant us a non-exclusive licence to use the prices and photos you submit to operate the service. Do not include personal data of others. We may moderate and remove content.',
        ],
      },
      {
        h: 'Sponsored content',
        p: [
          'Any paid placement is labelled “Sponsored” and never changes the order of organic price comparisons.',
        ],
      },
      {
        h: 'Complaints and removal requests',
        p: ['Use the “Report a problem / takedown” page. We acknowledge within 1 business day.'],
      },
      {
        h: 'Governing law',
        p: ['Laws of the State of Qatar. [Forum to be confirmed by counsel.]'],
      },
    ],
  },
  privacy: {
    title: 'Privacy Notice',
    sections: [
      {
        h: 'Who we are',
        p: [
          '[COMPANY NAME], Commercial Registration [CR NUMBER], [ADDRESS], Qatar, is the controller of your personal data under Law No. 13 of 2016 on Personal Data Privacy Protection. Contact: [PRIVACY EMAIL].',
        ],
      },
      {
        h: 'You can use the service without an account',
        p: ['Searching and comparing prices needs no account and no personal data from you.'],
      },
      {
        h: 'What we collect and why',
        p: [
          'Account: email, a salted password hash and language - to run your account. Saved baskets and price alerts - to provide those features. Search and basket history - only if you turn it on. Price reports and receipt photos - only if you submit them (we extract the price and delete the image within 7 days). Technical logs with a truncated IP address - for security. Anonymous usage statistics - only if you accept analytics.',
          'We do not collect national ID numbers, payment details, precise location, or information about health, religion, ethnicity or children. We do not sell personal data.',
        ],
      },
      {
        h: 'Who receives it',
        p: [
          'Hosting and security providers acting on our instructions (cloud hosting in the Qatar Central region, email delivery, error monitoring). Authorities only where the law requires.',
        ],
      },
      {
        h: 'How long we keep it',
        p: [
          'Account: until you delete it. History: 90 days. Receipt images: 7 days. Server logs: 30 days. Analytics: up to 13 months.',
        ],
      },
      {
        h: 'Your rights',
        p: [
          'You can access, correct and delete your data, withdraw consent, and object to processing. Use the Privacy centre in your account (download or delete your data) or email [PRIVACY EMAIL]. You may complain to the National Cyber Governance and Assurance Affairs (NCGAA).',
        ],
      },
      {
        h: 'Security',
        p: [
          'Encryption in transit and at rest, access controls and regular testing. If a breach is likely to cause serious damage we will notify you and the regulator as required by law.',
        ],
      },
      { h: 'Children', p: ['The service is for adults (18+).'] },
    ],
  },
  cookies: {
    title: 'Cookie Policy',
    sections: [
      {
        h: 'What we use',
        p: [
          'Strictly necessary: a session cookie (keeps you signed in), a consent cookie (remembers your choices) and a language cookie. They do not need consent.',
          'On your device only: your basket and area are kept in local storage and never sent to us unless you save your basket.',
        ],
      },
      {
        h: 'Optional',
        p: [
          'Anonymous usage statistics from a self-hosted tool. Off by default - loaded only if you accept. No advertising or cross-site tracking cookies.',
        ],
      },
      {
        h: 'Your choice',
        p: ['Change your choice any time with “Cookie settings” in the footer.'],
      },
    ],
  },
  about: {
    title: 'About Qarib and how we compare prices',
    sections: [
      {
        h: 'What this is',
        p: [
          'Qarib shows the price of a grocery item at the Qatari grocers we cover, so you can see where it is cheapest.',
        ],
      },
      {
        h: 'Where prices come from',
        p: [
          'Signed partner feeds, publicly distributed flyers (facts only, reviewed by a person), and reports from shoppers (published only when two people agree). We only collect data from sources that are approved, and we stop immediately if a retailer asks us to.',
        ],
      },
      {
        h: 'How we compare',
        p: [
          'Products are matched by barcode, brand, size and name. Different sizes and variants are never merged. Unit prices (per kg, litre or piece) make different pack sizes comparable.',
        ],
      },
      {
        h: 'Freshness',
        p: [
          'Every price shows when it was updated. Prices older than 7 days are flagged; prices older than 30 days are hidden.',
        ],
      },
      { h: 'What we do not show', p: ['Alcohol and tobacco products are not listed.'] },
      {
        h: 'Claims',
        p: [
          'We do not claim to be “cheapest in Qatar”. A basket comparison reflects the stores and products we cover on the date shown.',
        ],
      },
    ],
  },
};

const ar: Bodies = {
  terms: {
    title: 'شروط الاستخدام',
    sections: [
      {
        h: 'المشغّل',
        p: ['[COMPANY NAME]، سجل تجاري [CR NUMBER]، [ADDRESS]، قطر. للتواصل: [LEGAL EMAIL].'],
      },
      {
        h: 'الخدمة',
        p: [
          'قريب خدمة معلومات تقارن أسعار البقالة. نحن لا نبيع المواد الغذائية؛ تتم عمليات الشراء مع المتجر.',
        ],
      },
      {
        h: 'دقة الأسعار',
        p: [
          'الأسعار والعروض والتوفر مصدرها المتاجر والشركاء والمساهمون من المجتمع وقد تتغير في أي وقت. يظهر مع كل سعر وقت آخر تحديث. تحقق دائمًا من السعر في المتجر أو عند الدفع. لا نضمن الدقة أو الاكتمال.',
        ],
      },
      {
        h: 'عدم الارتباط',
        p: ['تُستخدم أسماء المتاجر للتعريف بها فقط. لا تزكّينا هذه المتاجر ما لم يُذكر خلاف ذلك.'],
      },
      {
        h: 'الأهلية والحسابات',
        p: [
          'يجب أن يكون عمرك 18 سنة أو أكثر. حافظ على بيانات دخولك؛ أنت مسؤول عن النشاط في حسابك.',
        ],
      },
      {
        h: 'الاستخدام المقبول',
        p: [
          'يُمنع الوصول الآلي إلى خدمتنا دون إذن، ومحاولة اختراق الأمان، والمحتوى المخالف للقانون أو المسيء أو المضلل أو المخالف للآداب العامة والقيم الإسلامية.',
        ],
      },
      {
        h: 'مساهمات المجتمع',
        p: [
          'تمنحنا ترخيصًا غير حصري لاستخدام الأسعار والصور التي ترسلها لتشغيل الخدمة. لا تُدرج بيانات شخصية لغيرك. يجوز لنا مراجعة المحتوى وإزالته.',
        ],
      },
      {
        h: 'المحتوى المدعوم',
        p: ['يُوسم أي محتوى مدفوع بعبارة «إعلان» ولا يغيّر أبدًا ترتيب مقارنة الأسعار الأصلية.'],
      },
      {
        h: 'الشكاوى وطلبات الإزالة',
        p: ['استخدم صفحة «الإبلاغ عن مشكلة / طلب إزالة». نقرّ باستلام الطلب خلال يوم عمل واحد.'],
      },
      {
        h: 'القانون الواجب التطبيق',
        p: ['قوانين دولة قطر. [تحدد جهة الاختصاص بعد مراجعة المستشار القانوني.]'],
      },
    ],
  },
  privacy: {
    title: 'إشعار الخصوصية',
    sections: [
      {
        h: 'من نحن',
        p: [
          '[COMPANY NAME]، سجل تجاري [CR NUMBER]، [ADDRESS]، قطر، هي المراقب لبياناتك الشخصية بموجب القانون رقم 13 لسنة 2016 بشأن حماية خصوصية البيانات الشخصية. للتواصل: [PRIVACY EMAIL].',
        ],
      },
      {
        h: 'يمكنك استخدام الخدمة دون حساب',
        p: ['البحث ومقارنة الأسعار لا يتطلبان حسابًا ولا أي بيانات شخصية منك.'],
      },
      {
        h: 'ما الذي نجمعه ولماذا',
        p: [
          'الحساب: البريد الإلكتروني وتجزئة مملّحة لكلمة المرور واللغة - لتشغيل حسابك. السلال المحفوظة وتنبيهات الأسعار - لتقديم هذه الميزات. سجل البحث والسلة - فقط إذا فعّلته. بلاغات الأسعار وصور الفواتير - فقط إذا أرسلتها (نستخرج السعر ونحذف الصورة خلال 7 أيام). سجلات تقنية بعنوان IP مقتطع - للأمن. إحصاءات الاستخدام المجهولة - فقط إذا قبلت التحليلات.',
          'لا نجمع الأرقام الشخصية ولا بيانات الدفع ولا الموقع الدقيق ولا معلومات عن الصحة أو الدين أو العرق أو الأطفال. ولا نبيع البيانات الشخصية.',
        ],
      },
      {
        h: 'من يستلم بياناتك',
        p: [
          'مزودو الاستضافة والأمن الذين يعملون وفق تعليماتنا (استضافة سحابية في منطقة قطر الوسطى، إرسال البريد، مراقبة الأخطاء). والجهات الرسمية فقط عند إلزام القانون.',
        ],
      },
      {
        h: 'مدة الاحتفاظ',
        p: [
          'الحساب: حتى تحذفه. السجل: 90 يومًا. صور الفواتير: 7 أيام. سجلات الخادم: 30 يومًا. التحليلات: حتى 13 شهرًا.',
        ],
      },
      {
        h: 'حقوقك',
        p: [
          'يمكنك الاطلاع على بياناتك وتصحيحها وحذفها وسحب موافقتك والاعتراض على المعالجة. استخدم مركز الخصوصية في حسابك (تنزيل بياناتك أو حذفها) أو راسل [PRIVACY EMAIL]. ويحق لك تقديم شكوى إلى إدارة الحوكمة والضمان السيبراني الوطني (NCGAA).',
        ],
      },
      {
        h: 'الأمن',
        p: [
          'تشفير أثناء النقل والتخزين وضوابط وصول واختبارات دورية. وإذا كان من المحتمل أن يسبب اختراق ضررًا جسيمًا فسنخطرك والجهة المختصة وفق القانون.',
        ],
      },
      { h: 'الأطفال', p: ['الخدمة مخصصة للبالغين (18 سنة فأكثر).'] },
    ],
  },
  cookies: {
    title: 'سياسة ملفات تعريف الارتباط',
    sections: [
      {
        h: 'ما الذي نستخدمه',
        p: [
          'الضرورية تمامًا: ملف الجلسة (يبقيك مسجلًا)، وملف الموافقة (يتذكر اختياراتك)، وملف اللغة. لا تحتاج إلى موافقة.',
          'على جهازك فقط: تُحفظ سلتك ومنطقتك في التخزين المحلي ولا تُرسل إلينا ما لم تحفظ سلتك.',
        ],
      },
      {
        h: 'الاختيارية',
        p: [
          'إحصاءات استخدام مجهولة من أداة مستضافة ذاتيًا. معطلة افتراضيًا - لا تُحمّل إلا إذا وافقت. لا ملفات إعلانية ولا تتبع عبر المواقع.',
        ],
      },
      {
        h: 'اختيارك',
        p: ['غيّر اختيارك في أي وقت عبر «إعدادات ملفات تعريف الارتباط» في أسفل الصفحة.'],
      },
    ],
  },
  about: {
    title: 'عن قريب وكيف نقارن الأسعار',
    sections: [
      {
        h: 'ما هذا الموقع',
        p: [
          'يعرض قريب سعر المنتج الغذائي لدى متاجر البقالة القطرية التي نغطيها لتعرف أين هو الأرخص.',
        ],
      },
      {
        h: 'مصدر الأسعار',
        p: [
          'ملفات بيانات موقّعة من الشركاء، ونشرات عروض موزعة علنًا (الحقائق فقط ويراجعها شخص)، وبلاغات المتسوقين (لا تُنشر إلا إذا اتفق عليها شخصان). نجمع البيانات من مصادر معتمدة فقط ونتوقف فورًا إذا طلب منا متجر ذلك.',
        ],
      },
      {
        h: 'كيف نقارن',
        p: [
          'تُطابق المنتجات بالباركود والعلامة التجارية والحجم والاسم. لا تُدمج الأحجام أو الأنواع المختلفة أبدًا. وتجعل أسعار الوحدة (للكيلو أو اللتر أو القطعة) الأحجام المختلفة قابلة للمقارنة.',
        ],
      },
      {
        h: 'حداثة البيانات',
        p: [
          'يظهر مع كل سعر وقت تحديثه. تُوسم الأسعار الأقدم من 7 أيام وتُخفى الأسعار الأقدم من 30 يومًا.',
        ],
      },
      { h: 'ما لا نعرضه', p: ['لا نعرض منتجات الكحول والتبغ.'] },
      {
        h: 'الادعاءات',
        p: [
          'لا ندّعي أننا «الأرخص في قطر». مقارنة السلة تعكس المتاجر والمنتجات التي نغطيها في التاريخ المعروض.',
        ],
      },
    ],
  },
};

export const legal = { en, ar };
