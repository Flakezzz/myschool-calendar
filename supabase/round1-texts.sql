-- MySchool — pass names and blurbs in the client's own voice.
-- Run once in the Supabase SQL Editor. Safe to re-run.
-- Only wording: prices and session counts are untouched by this file.

update subscriptions set
  title = 'такий базовий набірчік',
  sessions = '4 клаба на місяць',
  description = 'входять усі клаби школи'
where id = 'sub-4';

update subscriptions set
  title = 'такий норм набірчік',
  sessions = '8 клабів на місяць',
  description = 'ходи на шо хо: 8 клубів'
where id = 'sub-8';

update subscriptions set
  title = 'такий солідний набірчік',
  sessions = '12 клабів на місяць',
  description = 'ходи на шо хо, але вже більше разів'
where id = 'sub-12';

select id, title, sessions, description, price_uah from subscriptions order by price_uah;
