-- MySchool — тестові клаби на наступний місяць.
--
-- Створює по одному клабу щодня плюс два на сьогодні, щоб було на чому
-- перевіряти оплату, скасування за добу, скасування день у день і повну
-- відсутність місць.
--
-- Усі id починаються з 'test-', тож прибрати їх можна одним рядком:
--
--     delete from clubs where id like 'test-%';
--
-- Видалення клаба забирає і записи на нього (каскад), тож тестові оплати
-- зникнуть разом із ними. Справжніх клабів це не торкається.

-- Прибираємо попередній запуск, щоб скрипт можна було ганяти скільки треба.
delete from clubs where id like 'test-%';

-- ---------------------------------------------------------------- СЬОГОДНІ
-- Два клаби сьогодні: на них перевіряється скасування день у день (гроші
-- не повертаються) і нагадування за 3 години та за годину.
insert into clubs (id, title, description, date, start_time, end_time, teacher,
                   level, seats, taken, price_uah, color, meeting_url, video_url)
select
  'test-today-' || h || 'h',
  case h when 2 then 'меми клаб сьогодні' else 'мувi клаб сьогодні' end,
  'тестовий клаб на сьогодні — на ньому перевіряємо скасування день у день',
  (now() at time zone 'Europe/Kyiv')::date,
  date_trunc('minute', (now() at time zone 'Europe/Kyiv') + make_interval(hours => h))::time,
  date_trunc('minute', (now() at time zone 'Europe/Kyiv') + make_interval(hours => h + 1))::time,
  'колос', 'A2–B1', 10, 0, h, '#E85D4C',
  'https://meet.google.com/test-today-' || h,
  'https://youtu.be/dQw4w9WgXcQ'
from (values (2), (4)) as t(h);

-- ---------------------------------------------------------------- 30 ДНІВ
-- По одному на день. Ціни навмисне копійчані, бо це пісочниця.
insert into clubs (id, title, description, date, start_time, end_time, teacher,
                   level, seats, taken, price_uah, color, meeting_url, video_url)
select
  'test-' || d,
  (array['movie club', 'reading club', 'memes club', 'business club',
         'taro club', 'спід дейтінг клаб', 'save the drama club'])[1 + (i % 7)],
  'тестовий клаб на ' || to_char(d, 'DD.MM') || ' — можна сміливо записуватись і скасовувати',
  d,
  '18:00'::time,
  '19:00'::time,
  (array['колос', 'наташксуперстар', 'лаура', 'бакс'])[1 + (i % 4)],
  (array['A1', 'A2–B1', 'B1+', 'B2'])[1 + (i % 4)],
  -- кожен сьомий без вільних місць, щоб перевірити «все, місць нема»
  case when i % 7 = 0 then 3 else 10 end,
  case when i % 7 = 0 then 3 else 0 end,
  1 + (i % 5),
  (array['#E85D4C', '#3BA99C', '#E8B86D', '#1B4D6E', '#8E5FD1'])[1 + (i % 5)],
  'https://meet.google.com/test-' || d,
  -- справжні класичні меми, перевірені по назвах
  (array['https://youtu.be/jNQXAC9IVRw',   -- Me at the zoo
         'https://youtu.be/MtN1YnoL46Q',   -- The Duck Song
         'https://youtu.be/HPPj6viIBmU',   -- Star Wars Kid
         'https://youtu.be/uE-1RPDqJAY',   -- taking the hobbits to isengard
         'https://youtu.be/FR7wOGyAzpw',   -- Fabulous Secret Powers
         'https://youtu.be/EwTZ2xpQwpA',   -- Chocolate Rain
         'https://youtu.be/dQw4w9WgXcQ'])[1 + (i % 7)]
from generate_series(1, 30) as i,
     lateral (select ((now() at time zone 'Europe/Kyiv')::date + i) as d) x;

select date, title, price_uah || ' грн' as ціна, taken || '/' || seats as місця
from clubs where id like 'test-%' order by date, start_time limit 8;
