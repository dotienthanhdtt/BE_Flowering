/**
 * Seed data for scenario_categories and scenarios tables.
 * All scenarios have language_id = NULL (global — visible for all languages).
 * Mix of free, trial, and premium scenarios per category.
 */

export const seedScenarioCategoriesQuery = `
  INSERT INTO scenario_categories (name, icon, order_index, is_active)
  VALUES
    ('Daily Life',              '🏠', 0, true),
    ('Travel & Transportation', '✈️', 1, true),
    ('Food & Dining',           '🍜', 2, true),
    ('Business & Work',         '💼', 3, true),
    ('Shopping',                '🛍️', 4, true),
    ('Healthcare',              '🏥', 5, true),
    ('Social & Hobbies',        '🎉', 6, true)
  ON CONFLICT DO NOTHING;
`;

/**
 * Inserts scenarios referencing categories by name via subquery.
 * Idempotent: skips rows with duplicate (category_id, title) if such a constraint exists;
 * otherwise safe to run once via migration.
 */
export const seedScenariosQuery = `
  WITH cats AS (
    SELECT id, name FROM scenario_categories
  )
  INSERT INTO scenarios
    (category_id, language_id, title, description, difficulty, is_premium, is_trial, is_active, order_index)
  VALUES
    -- Daily Life (free + trial + premium)
    ((SELECT id FROM cats WHERE name = 'Daily Life'), NULL, 'Morning Routine',
     'Practice greeting your family, making breakfast, and planning your day.',
     'beginner', false, false, true, 0),

    ((SELECT id FROM cats WHERE name = 'Daily Life'), NULL, 'Asking for Directions',
     'Learn to ask and understand directions in everyday situations.',
     'beginner', true, true, true, 1),

    ((SELECT id FROM cats WHERE name = 'Daily Life'), NULL, 'Discussing Weekend Plans',
     'Talk about hobbies, activities, and making plans with friends.',
     'intermediate', false, false, true, 2),

    ((SELECT id FROM cats WHERE name = 'Daily Life'), NULL, 'Making Phone Calls',
     'Handle both formal and informal phone calls confidently.',
     'intermediate', true, false, true, 3),

    -- Travel & Transportation
    ((SELECT id FROM cats WHERE name = 'Travel & Transportation'), NULL, 'At the Airport',
     'Navigate check-in, security, and boarding gate conversations.',
     'beginner', false, false, true, 0),

    ((SELECT id FROM cats WHERE name = 'Travel & Transportation'), NULL, 'Booking a Hotel',
     'Reserve a room, ask about amenities, and handle check-in/out.',
     'intermediate', true, true, true, 1),

    ((SELECT id FROM cats WHERE name = 'Travel & Transportation'), NULL, 'Using Public Transport',
     'Buy tickets, read timetables, and ask locals for help.',
     'beginner', false, false, true, 2),

    ((SELECT id FROM cats WHERE name = 'Travel & Transportation'), NULL, 'Dealing with Travel Problems',
     'Handle lost luggage, flight delays, and emergencies abroad.',
     'advanced', true, false, true, 3),

    -- Food & Dining
    ((SELECT id FROM cats WHERE name = 'Food & Dining'), NULL, 'Ordering at a Restaurant',
     'Read menus, place orders, and interact with wait staff.',
     'beginner', false, false, true, 0),

    ((SELECT id FROM cats WHERE name = 'Food & Dining'), NULL, 'Describing Food Preferences',
     'Express dietary restrictions, allergies, and taste preferences.',
     'intermediate', true, true, true, 1),

    ((SELECT id FROM cats WHERE name = 'Food & Dining'), NULL, 'Cooking & Recipes',
     'Discuss ingredients, cooking methods, and share recipes.',
     'intermediate', false, false, true, 2),

    ((SELECT id FROM cats WHERE name = 'Food & Dining'), NULL, 'Fine Dining Etiquette',
     'Navigate formal dining settings with confidence and grace.',
     'advanced', true, false, true, 3),

    -- Business & Work
    ((SELECT id FROM cats WHERE name = 'Business & Work'), NULL, 'Job Interview',
     'Introduce yourself, discuss experience, and answer common interview questions.',
     'intermediate', false, false, true, 0),

    ((SELECT id FROM cats WHERE name = 'Business & Work'), NULL, 'Team Meeting',
     'Participate in meetings, share opinions, and follow up on action items.',
     'intermediate', true, true, true, 1),

    ((SELECT id FROM cats WHERE name = 'Business & Work'), NULL, 'Writing Professional Emails',
     'Draft clear and polite emails for various business scenarios.',
     'intermediate', false, false, true, 2),

    ((SELECT id FROM cats WHERE name = 'Business & Work'), NULL, 'Presenting Data & Reports',
     'Present findings, handle Q&A, and persuade stakeholders.',
     'advanced', true, false, true, 3),

    -- Shopping
    ((SELECT id FROM cats WHERE name = 'Shopping'), NULL, 'Shopping at a Market',
     'Browse, compare prices, and negotiate at local markets.',
     'beginner', false, false, true, 0),

    ((SELECT id FROM cats WHERE name = 'Shopping'), NULL, 'Online Shopping & Delivery',
     'Place orders, track packages, and deal with customer service.',
     'intermediate', true, true, true, 1),

    ((SELECT id FROM cats WHERE name = 'Shopping'), NULL, 'Returning & Exchanging Items',
     'Handle refunds, exchanges, and complaints professionally.',
     'intermediate', true, false, true, 2),

    -- Healthcare
    ((SELECT id FROM cats WHERE name = 'Healthcare'), NULL, 'Doctor Appointment',
     'Describe symptoms, understand prescriptions, and book follow-ups.',
     'beginner', false, false, true, 0),

    ((SELECT id FROM cats WHERE name = 'Healthcare'), NULL, 'Describing Symptoms',
     'Use precise vocabulary to explain pain, discomfort, and medical history.',
     'intermediate', true, true, true, 1),

    ((SELECT id FROM cats WHERE name = 'Healthcare'), NULL, 'At the Pharmacy',
     'Ask for medicines, understand dosage instructions, and side effects.',
     'beginner', false, false, true, 2),

    -- Social & Hobbies
    ((SELECT id FROM cats WHERE name = 'Social & Hobbies'), NULL, 'Meeting New People',
     'Small talk, introductions, and building rapport in social settings.',
     'beginner', false, false, true, 0),

    ((SELECT id FROM cats WHERE name = 'Social & Hobbies'), NULL, 'Movies, Music & TV Shows',
     'Discuss entertainment, share recommendations, and debate opinions.',
     'intermediate', false, false, true, 1),

    ((SELECT id FROM cats WHERE name = 'Social & Hobbies'), NULL, 'Planning a Party or Event',
     'Invite guests, coordinate logistics, and manage RSVPs.',
     'intermediate', true, false, true, 2)
  ;
`;
