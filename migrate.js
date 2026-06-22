const { executeQuery } = require('./db');

async function migrate() {
  try {
    console.log('Migrasiya başladı...');
    
    // 1. Column əlavə edirik
    try {
      await executeQuery('ALTER TABLE odenis_tarixcesi ADD istifadeci_id NUMBER');
      console.log('1. istifadeci_id sütunu əlavə edildi.');
    } catch (e) {
      if (e.message.includes('ORA-01430')) {
        console.log('1. istifadeci_id sütunu artıq mövcuddur.');
      } else {
        throw e;
      }
    }

    // 2. Mövcud qeydlərin istifadeci_id-lərini abunəliklər cədvəlindən götürüb doldururuq
    await executeQuery(`
      UPDATE odenis_tarixcesi ot
      SET ot.istifadeci_id = (
        SELECT a.istifadeci_id 
        FROM abunelikler a 
        WHERE a.id = ot.abunelik_id
      )
      WHERE ot.istifadeci_id IS NULL
    `, {}, { autoCommit: true });
    console.log('2. Mövcud ödəniş tarixçələrinin istifadəçi ID-ləri yeniləndi.');

    // 3. Foreign Key məhdudiyyəti əlavə edirik (əgər yoxdursa)
    try {
      await executeQuery(`
        ALTER TABLE odenis_tarixcesi 
        ADD CONSTRAINT fk_odenis_istifadeci 
        FOREIGN KEY (istifadeci_id) 
        REFERENCES istifadeciler(id) 
        ON DELETE CASCADE
      `);
      console.log('3. Foreign Key məhdudiyyəti əlavə edildi.');
    } catch (e) {
      if (e.message.includes('ORA-02275') || e.message.includes('already exists')) {
        console.log('3. Foreign Key məhdudiyyəti artıq mövcuddur.');
      } else {
        throw e;
      }
    }

    console.log('Migrasiya uğurla tamamlandı!');
  } catch (err) {
    console.error('Migrasiya xətası:', err.message);
  }
}

migrate();
