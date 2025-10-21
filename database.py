import psycopg2
import os
from contextlib import contextmanager

class Database:
    def __init__(self):
        self.database_url = os.environ.get('DATABASE_URL')
        self.init_db()
    
    @contextmanager
    def get_connection(self):
        # Fix for Render's PostgreSQL URL
        database_url = self.database_url
        if database_url and database_url.startswith("postgres://"):
            database_url = database_url.replace("postgres://", "postgresql://", 1)
        
        conn = psycopg2.connect(database_url)
        try:
            yield conn
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            conn.close()
    
    def init_db(self):
        with self.get_connection() as conn:
            with conn.cursor() as cur:
                # Users table
                cur.execute('''
                    CREATE TABLE IF NOT EXISTS users (
                        id TEXT PRIMARY KEY,
                        email TEXT UNIQUE NOT NULL,
                        whatsapp_ready BOOLEAN DEFAULT FALSE,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                ''')
                
                # Orders table (modified for multi-user)
                cur.execute('''
                    CREATE TABLE IF NOT EXISTS confirmed_orders (
                        id SERIAL PRIMARY KEY,
                        user_id TEXT NOT NULL,
                        session_id TEXT NOT NULL,
                        product TEXT NOT NULL,
                        quantity INTEGER NOT NULL,
                        status TEXT DEFAULT 'confirmed',
                        order_group TEXT DEFAULT 'main',
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                ''')
                
                # WhatsApp sessions table
                cur.execute('''
                    CREATE TABLE IF NOT EXISTS whatsapp_sessions (
                        user_id TEXT PRIMARY KEY,
                        client_id TEXT NOT NULL,
                        ready BOOLEAN DEFAULT FALSE,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                ''')
            conn.commit()
    
    def create_user(self, user_id, email):
        with self.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    'INSERT INTO users (id, email) VALUES (%s, %s)',
                    (user_id, email)
                )
            conn.commit()
    
    def get_user(self, user_id):
        with self.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute('SELECT * FROM users WHERE id = %s', (user_id,))
                result = cur.fetchone()
                if result:
                    return {
                        'id': result[0],
                        'email': result[1],
                        'whatsapp_ready': result[2],
                        'created_at': result[3]
                    }
                return None
    
    def get_user_by_email(self, email):
        with self.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute('SELECT * FROM users WHERE email = %s', (email,))
                result = cur.fetchone()
                if result:
                    return {
                        'id': result[0],
                        'email': result[1],
                        'whatsapp_ready': result[2],
                        'created_at': result[3]
                    }
                return None
    
    def update_whatsapp_status(self, user_id, ready):
        with self.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    'UPDATE users SET whatsapp_ready = %s WHERE id = %s',
                    (ready, user_id)
                )
            conn.commit()
    
    def save_whatsapp_session(self, user_id, client_id, ready=False):
        with self.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute('''
                    INSERT INTO whatsapp_sessions (user_id, client_id, ready) 
                    VALUES (%s, %s, %s)
                    ON CONFLICT (user_id) 
                    DO UPDATE SET client_id = %s, ready = %s, updated_at = CURRENT_TIMESTAMP
                ''', (user_id, client_id, ready, client_id, ready))
            conn.commit()
    
    def get_whatsapp_session(self, user_id):
        with self.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute('SELECT * FROM whatsapp_sessions WHERE user_id = %s', (user_id,))
                result = cur.fetchone()
                if result:
                    return {
                        'user_id': result[0],
                        'client_id': result[1],
                        'ready': result[2]
                    }
                return None
