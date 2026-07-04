# Abunəlik İdarəetmə Platforması API (PostgreSQL + Swagger)

Bu layihə, istifadəçilərin bütün abunəliklərini (Netflix, Spotify, AWS və s.) bir yerdən idarə etməsinə kömək edən backend API layihəsidir. PostgreSQL verilənlər bazasına qoşulur və Swagger UI vasitəsilə vizual test imkanı təqdim edir.

## Özəllikləri
* **İstifadəçilərin idarə edilməsi** (Yaratma və siyahılama)
* **Abunəliklərin idarə edilməsi** (Yeni abunəlik əlavə etmə, izləmə)
* **Xərclərin analitikası** (Valyutaya görə aylıq xərclərin cəmlənməsi)
* **Bildirişlər sistemi** (Ödəniş xəbərdarlıqlarının göndərilməsi)
* **Büdcə limitləri** (Aylıq limit təyini və izlənilməsi)

---

## Necə işə salmalı?

### 1. Kitabxanaları yükləyin (Install Dependencies)
Layihə qovluğunda (`oracle-swagger-api`) Terminal açın və bu komandanı işlədin:

```bash
npm install
```

### 2. Bazanın Qoşulma Məlumatlarını Yoxlayın
`.env` faylının içərisində verilənlər bazası qoşulma məlumatları yazılıb. Neon PostgreSQL bazanızın qoşulma linkinə uyğun gəldiyini yoxlayın:
```env
PORT=3000
DATABASE_URL=postgresql://username:password@hostname/dbname?sslmode=require
API_USER=admin
API_PASSWORD=admin123
```

### 3. Serveri işə salın
Terminalda aşağıdakı komandanı yazaraq backend layihəsini başladın:

```bash
npm start
```
*(Əgər kodda dəyişiklik etdikcə serverin avtomatik yenilənməsini istəyirsinizsə: `npm run dev` komandasını yaza bilərsiniz).*

---

## Swagger-də Test Etmək

Server işə düşdükdən sonra brauzerinizdə bu ünvana daxil olun:

👉 **[http://localhost:3000/api-docs](http://localhost:3000/api-docs)**

Açılan Swagger UI interfeysində:
1. **`GET /api/istifadeciler/{username}`** üzərinə klikləyin, **Try it out** düyməsini sıxın, username daxil edib **Execute** edin.
2. **`POST /api/istifadeciler`** ilə yeni istifadəçi yarada bilərsiniz.
3. **`GET /api/abunelikler`** ilə istifadəçinin bütün abunəliklərini siyahılaya bilərsiniz.
