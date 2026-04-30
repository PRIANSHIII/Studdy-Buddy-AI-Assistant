import sqlite3
import os
from datetime import datetime


class Database:
    def __init__(self, db_path='study_buddy.db'):
        self.db_path = db_path
        self.init_db()

    def get_connection(self):
        """Get database connection"""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def init_db(self):
        """Initialize database tables"""
        conn = self.get_connection()
        try:
            # Users table
            conn.execute('''
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    email TEXT UNIQUE NOT NULL,
                    name TEXT NOT NULL,
                    age TEXT,
                    class TEXT,
                    institution TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')

            # Study sessions table
            conn.execute('''
                CREATE TABLE IF NOT EXISTS study_sessions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_email TEXT NOT NULL,
                    activity TEXT NOT NULL,
                    topic TEXT,
                    duration REAL DEFAULT 0,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_email) REFERENCES users (email)
                )
            ''')

            # Uploaded files table
            conn.execute('''
                CREATE TABLE IF NOT EXISTS uploaded_files (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_email TEXT NOT NULL,
                    filename TEXT NOT NULL,
                    file_type TEXT NOT NULL,
                    file_path TEXT NOT NULL,
                    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_email) REFERENCES users (email)
                )
            ''')

            # Generated notes table
            conn.execute('''
                CREATE TABLE IF NOT EXISTS generated_notes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_email TEXT NOT NULL,
                    original_filename TEXT NOT NULL,
                    generated_filename TEXT NOT NULL,
                    file_path TEXT NOT NULL,
                    generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_email) REFERENCES users (email)
                )
            ''')

            # Flashcards table
            conn.execute('''
                CREATE TABLE IF NOT EXISTS flashcards (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_email TEXT NOT NULL,
                    note_filename TEXT NOT NULL,
                    question TEXT NOT NULL,
                    answer TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_email) REFERENCES users (email)
                )
            ''')

            # Study plans table
            conn.execute('''
                CREATE TABLE IF NOT EXISTS study_plans (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_email TEXT NOT NULL,
                    syllabus_filename TEXT NOT NULL,
                    plan_filename TEXT NOT NULL,
                    file_path TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_email) REFERENCES users (email)
                )
            ''')

            conn.commit()
        except Exception as e:
            print(f"Database initialization error: {e}")
        finally:
            conn.close()

    # User management methods
    def create_user(self, email, name, age=None, class_info=None, institution=None):
        """Create or update user"""
        conn = self.get_connection()
        try:
            conn.execute('''
                INSERT OR REPLACE INTO users (email, name, age, class, institution)
                VALUES (?, ?, ?, ?, ?)
            ''', (email, name, age, class_info, institution))
            conn.commit()
            return True
        except Exception as e:
            print(f"Error creating user: {e}")
            return False
        finally:
            conn.close()

    def get_user(self, email):
        """Get user by email"""
        conn = self.get_connection()
        try:
            user = conn.execute(
                'SELECT * FROM users WHERE email = ?', (email,)
            ).fetchone()
            return dict(user) if user else None
        except Exception as e:
            print(f"Error getting user: {e}")
            return None
        finally:
            conn.close()

    def update_user_profile(self, email, **updates):
        """Update user profile"""
        conn = self.get_connection()
        try:
            set_clause = ', '.join([f"{key} = ?" for key in updates.keys()])
            values = list(updates.values())
            values.append(email)

            conn.execute(f'''
                UPDATE users SET {set_clause} WHERE email = ?
            ''', values)
            conn.commit()
            return True
        except Exception as e:
            print(f"Error updating user: {e}")
            return False
        finally:
            conn.close()

    # Study sessions methods
    def add_study_session(self, user_email, activity, duration=0, topic=None):
        """Add study session"""
        conn = self.get_connection()
        try:
            conn.execute('''
                INSERT INTO study_sessions (user_email, activity, duration, topic)
                VALUES (?, ?, ?, ?)
            ''', (user_email, activity, duration, topic))
            conn.commit()
            return True
        except Exception as e:
            print(f"Error adding study session: {e}")
            return False
        finally:
            conn.close()

    def get_user_study_sessions(self, user_email, limit=None):
        """Get study sessions for user"""
        conn = self.get_connection()
        try:
            query = '''
                SELECT * FROM study_sessions 
                WHERE user_email = ? 
                ORDER BY timestamp DESC
            '''
            if limit:
                query += ' LIMIT ?'
                sessions = conn.execute(query, (user_email, limit)).fetchall()
            else:
                sessions = conn.execute(query, (user_email,)).fetchall()
            return [dict(session) for session in sessions]
        except Exception as e:
            print(f"Error getting study sessions: {e}")
            return []
        finally:
            conn.close()

    def get_user_progress_stats(self, user_email):
        """Get comprehensive progress statistics for user"""
        conn = self.get_connection()
        try:
            # Total study time
            total_time = conn.execute(
                'SELECT SUM(duration) as total FROM study_sessions WHERE user_email = ?',
                (user_email,)
            ).fetchone()['total'] or 0

            # Topics covered
            topics = conn.execute(
                'SELECT DISTINCT topic FROM study_sessions WHERE user_email = ? AND topic IS NOT NULL',
                (user_email,)
            ).fetchall()
            topics_covered = len(topics)

            # Activity counts
            activity_counts = {}
            activities = conn.execute('''
                SELECT activity, COUNT(*) as count FROM study_sessions 
                WHERE user_email = ? GROUP BY activity
            ''', (user_email,)).fetchall()

            for activity in activities:
                activity_counts[activity['activity']] = activity['count']

            # Study streak (simplified - counts consecutive days with study sessions)
            streak_days = conn.execute('''
                SELECT COUNT(DISTINCT DATE(timestamp)) as streak 
                FROM study_sessions 
                WHERE user_email = ? AND DATE(timestamp) >= DATE('now', '-7 days')
            ''', (user_email,)).fetchone()['streak']

            return {
                'total_study_time': total_time,
                'topics_covered': topics_covered,
                'activity_counts': activity_counts,
                'current_streak': streak_days,
                'total_sessions': len(activities)
            }
        except Exception as e:
            print(f"Error getting progress stats: {e}")
            return {}
        finally:
            conn.close()

    # File management methods
    def add_uploaded_file(self, user_email, filename, file_type, file_path):
        """Record uploaded file"""
        conn = self.get_connection()
        try:
            conn.execute('''
                INSERT INTO uploaded_files (user_email, filename, file_type, file_path)
                VALUES (?, ?, ?, ?)
            ''', (user_email, filename, file_type, file_path))
            conn.commit()
            return True
        except Exception as e:
            print(f"Error adding uploaded file: {e}")
            return False
        finally:
            conn.close()

    def get_user_files(self, user_email, file_type=None):
        """Get user's uploaded files"""
        conn = self.get_connection()
        try:
            if file_type:
                files = conn.execute(
                    'SELECT * FROM uploaded_files WHERE user_email = ? AND file_type = ? ORDER BY uploaded_at DESC',
                    (user_email, file_type)
                ).fetchall()
            else:
                files = conn.execute(
                    'SELECT * FROM uploaded_files WHERE user_email = ? ORDER BY uploaded_at DESC',
                    (user_email,)
                ).fetchall()
            return [dict(file) for file in files]
        except Exception as e:
            print(f"Error getting user files: {e}")
            return []
        finally:
            conn.close()

    def delete_uploaded_file(self, user_email, filename):
        """Delete uploaded file record"""
        conn = self.get_connection()
        try:
            conn.execute(
                'DELETE FROM uploaded_files WHERE user_email = ? AND filename = ?',
                (user_email, filename)
            )
            conn.commit()
            return True
        except Exception as e:
            print(f"Error deleting file: {e}")
            return False
        finally:
            conn.close()

    # Generated notes methods
    def add_generated_note(self, user_email, original_filename, generated_filename, file_path):
        """Record generated note"""
        conn = self.get_connection()
        try:
            conn.execute('''
                INSERT INTO generated_notes (user_email, original_filename, generated_filename, file_path)
                VALUES (?, ?, ?, ?)
            ''', (user_email, original_filename, generated_filename, file_path))
            conn.commit()
            return True
        except Exception as e:
            print(f"Error adding generated note: {e}")
            return False
        finally:
            conn.close()

    def get_user_generated_notes(self, user_email):
        """Get user's generated notes"""
        conn = self.get_connection()
        try:
            notes = conn.execute(
                'SELECT * FROM generated_notes WHERE user_email = ? ORDER BY generated_at DESC',
                (user_email,)
            ).fetchall()
            return [dict(note) for note in notes]
        except Exception as e:
            print(f"Error getting generated notes: {e}")
            return []
        finally:
            conn.close()

    # Flashcards methods
    def save_flashcards(self, user_email, note_filename, flashcards):
        """Save flashcards to database"""
        conn = self.get_connection()
        try:
            # Delete existing flashcards for this note
            conn.execute(
                'DELETE FROM flashcards WHERE user_email = ? AND note_filename = ?',
                (user_email, note_filename)
            )

            # Insert new flashcards
            for card in flashcards:
                conn.execute('''
                    INSERT INTO flashcards (user_email, note_filename, question, answer)
                    VALUES (?, ?, ?, ?)
                ''', (user_email, note_filename, card['question'], card['answer']))

            conn.commit()
            return True
        except Exception as e:
            print(f"Error saving flashcards: {e}")
            return False
        finally:
            conn.close()

    def get_user_flashcards(self, user_email, note_filename=None):
        """Get user's flashcards"""
        conn = self.get_connection()
        try:
            if note_filename:
                flashcards = conn.execute(
                    'SELECT * FROM flashcards WHERE user_email = ? AND note_filename = ? ORDER BY created_at DESC',
                    (user_email, note_filename)
                ).fetchall()
            else:
                flashcards = conn.execute(
                    'SELECT * FROM flashcards WHERE user_email = ? ORDER BY created_at DESC',
                    (user_email,)
                ).fetchall()
            return [dict(card) for card in flashcards]
        except Exception as e:
            print(f"Error getting flashcards: {e}")
            return []
        finally:
            conn.close()


# Global database instance
db = Database()