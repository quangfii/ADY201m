USE ADY201m;
SELECT TOP (1000) collected_at AS collected_at_utc,
 DATEADD(HOUR,7,collected_at) AS collected_at_vietnam,
 supermarket,name,size,category,actual_price,product_url
FROM dbo.PriceObservations ORDER BY collected_at DESC;

SELECT supermarket,COUNT(*) AS observations,MAX(collected_at) AS latest_collected_at_utc
FROM dbo.PriceObservations GROUP BY supermarket;
