const { executeQuery } = require('./db');

async function seed() {
  console.log('Test məlumatlarının daxil edilməsi başladı...');
  try {
    // 1. Ödəniş metodları (odenis_metodlari)
    await executeQuery(`
      INSERT INTO odenis_metodlari (istifadeci_id, ad, kart_tipi, son_dord_reqem, kart_istifade_tarixi, status)
      VALUES (1, 'Maaş Kartı', 'MasterCard', '5544', '12/28', 'active')
    `, {}, { autoCommit: true });
    
    await executeQuery(`
      INSERT INTO odenis_metodlari (istifadeci_id, ad, kart_tipi, son_dord_reqem, kart_istifade_tarixi, status)
      VALUES (1, 'Təqaüd Kartı', 'Visa', '1122', '08/29', 'active')
    `, {}, { autoCommit: true });

    await executeQuery(`
      INSERT INTO odenis_metodlari (istifadeci_id, ad, kart_tipi, son_dord_reqem, kart_istifade_tarixi, status)
      VALUES (2, 'BirKart', 'Visa', '4321', '03/27', 'active')
    `, {}, { autoCommit: true });

    console.log('Ödəniş metodları daxil edildi.');

    // 2. Qlobal abunəlik xidmətləri (abunelik_xidmetleri)
    const services = [
      { name: 'Netflix', logo: 'https://cdn.logo.com/netflix.png', web: 'www.netflix.com', cat: 'Entertainment' },
      { name: 'Spotify', logo: 'https://cdn.logo.com/spotify.png', web: 'www.spotify.com', cat: 'Music' },
      { name: 'YouTube Premium', logo: 'https://cdn.logo.com/youtube.png', web: 'www.youtube.com', cat: 'Entertainment' },
      { name: 'AWS Cloud', logo: 'https://cdn.logo.com/aws.png', web: 'aws.amazon.com', cat: 'Cloud' },
      { name: 'Canva', logo: 'https://cdn.logo.com/canva.png', web: 'www.canva.com', cat: 'Design' }
    ];

    for (const service of services) {
      try {
        await executeQuery(`
          INSERT INTO abunelik_xidmetleri (ad, logo_url, vebsayt, kateqoriya)
          VALUES (:name, :logo, :web, :cat)
        `, { name: service.name, logo: service.logo, web: service.web, cat: service.cat }, { autoCommit: true });
      } catch (err) {
        if (err.message && err.message.includes('ORA-00001')) {
          // unique constraint, already seeded
        } else {
          throw err;
        }
      }
    }
    console.log('Qlobal abunəlik xidmətləri daxil edildi.');

    // 3. Büdcə limitləri (budceler)
    await executeQuery(`
      INSERT INTO budceler (istifadeci_id, limit_mebleq, valyuta, bildiris_faizi)
      VALUES (1, 60.00, 'AZN', 90.00)
    `, {}, { autoCommit: true });

    await executeQuery(`
      INSERT INTO budceler (istifadeci_id, limit_mebleq, valyuta, bildiris_faizi)
      VALUES (2, 35.00, 'USD', 95.00)
    `, {}, { autoCommit: true });

    console.log('Büdcə limitləri daxil edildi.');

    // 4. İstifadəçi ayarları (istifadeci_ayarlari)
    try {
      await executeQuery(`
        INSERT INTO istifadeci_ayarlari (istifadeci_id, esas_valyuta, bildiris_metodu, dil, tema)
        VALUES (1, 'AZN', 'email', 'az', 'dark')
      `, {}, { autoCommit: true });
    } catch (err) {}

    try {
      await executeQuery(`
        INSERT INTO istifadeci_ayarlari (istifadeci_id, esas_valyuta, bildiris_metodu, dil, tema)
        VALUES (2, 'USD', 'telegram', 'en', 'light')
      `, {}, { autoCommit: true });
    } catch (err) {}

    console.log('İstifadəçi ayarları daxil edildi.');
    console.log('Bütün test məlumatları uğurla əlavə olundu!');

  } catch (err) {
    console.error('Seed xətası:', err.message);
  }
}

seed();
