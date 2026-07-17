DO $$
BEGIN
  PERFORM cron.unschedule('dkdash-turno-push-check');
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END $$;

SELECT cron.schedule(
  'dkdash-turno-push-check',
  '10 seconds',
  $$
  SELECT net.http_post(
    url := 'https://ttnpouzoswhhqvedvngx.supabase.co/functions/v1/dkdash-turno-poll',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR0bnBvdXpvc3doaHF2ZWR2bmd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4NDg2NTIsImV4cCI6MjA5MzQyNDY1Mn0.g4A96sPBljGuxNi-mTwcE5exA1cv2SKn8IEIw79B0FY',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR0bnBvdXpvc3doaHF2ZWR2bmd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4NDg2NTIsImV4cCI6MjA5MzQyNDY1Mn0.g4A96sPBljGuxNi-mTwcE5exA1cv2SKn8IEIw79B0FY'
    ),
    body := jsonb_build_object('source', 'cron')
  );
  $$
);