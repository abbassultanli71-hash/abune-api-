# Abunəlik İdarəetmə Platforması API (Oracle + Swagger)

Bu layihə, istifadəçilərin bütün abunəliklərini (Netflix, Spotify, AWS və s.) bir yerdən idarə etməsinə kömək edən backend API layihəsidir. Oracle verilənlər bazasına qoşulur və Swagger UI vasitəsilə vizual test imkanı təqdim edir.

## Özəllikləri
* **İstifadəçilərin idarə edilməsi** (Yaratma və siyahılama)
* **Abunəliklərin idarə edilməsi** (Yeni abunəlik əlavə etmə, izləmə)
* **Xərclərin analitikası** (Valyutaya görə aylıq xərclərin cəmlənməsi)
* **Bildirişlər sistemi** (Ödəniş xəbərdarlıqlarının göndərilməsi)

---

## Necə işə salmalı?

### 1. Kitabxanaları yükləyin (Install Dependencies)
Layihə qovluğunda (`oracle-swagger-api`) Git Bash və ya Terminal açın və bu komandanı işlədin:

```bash
npm install
```

### 2. Bazanın Qoşulma Məlumatlarını Yoxlayın
`.env` faylının içərisində verilənlər bazası qoşulma məlumatları yazılıb. Docker-dəki bazanızın portuna və şifrəsinə uyğun gəldiyini yoxlayın:
```env
PORT=3000
DB_USER=system
DB_PASSWORD=mysecurepassword
DB_CONNECT_STRING=localhost:1522/FREE
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
1. **`GET /api/istifadeciler`** üzərinə klikləyin, **Try it out** düyməsini sıxın və sonra **Execute** edin. Bazadakı Abbas və Elnur istifadəçilərini görəcəksiniz.
2. **`POST /api/istifadeciler`** ilə yeni istifadəçi yarada bilərsiniz.
3. **`GET /api/abunelikler/analitika`** ilə ümumi aylıq abunəlik xərclərini görə bilərsiniz.
