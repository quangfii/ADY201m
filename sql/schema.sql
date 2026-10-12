IF OBJECT_ID('dbo.PriceObservations', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.PriceObservations (
        id varchar(64) NOT NULL PRIMARY KEY,
        collected_at datetime2(3) NOT NULL,
        supermarket nvarchar(50) NOT NULL,
        product_identity nvarchar(2000) NOT NULL,
        match_key nvarchar(2000) NOT NULL,
        category nvarchar(500) NOT NULL,
        actual_price decimal(18,2) NOT NULL CHECK(actual_price > 0),
        name nvarchar(2000) NOT NULL,
        size nvarchar(500) NOT NULL,
        product_url nvarchar(2000) NOT NULL,
        payload nvarchar(max) NOT NULL CHECK(ISJSON(payload)=1));
    CREATE INDEX IX_Prices_StoreTime ON dbo.PriceObservations(supermarket, collected_at);
    CREATE INDEX IX_Prices_CategoryTime ON dbo.PriceObservations(category, collected_at);
END;
IF OBJECT_ID('dbo.ImportMetadata', 'U') IS NULL
    CREATE TABLE dbo.ImportMetadata ([key] nvarchar(100) PRIMARY KEY, value nvarchar(2000));
