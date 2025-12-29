-- Create profiles table (extends auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  username TEXT,
  avatar_url TEXT,
  bio TEXT,
  skin_type TEXT[], -- e.g., ["dry"], ["oily"], ["combination"]
  skin_concerns TEXT[], -- Array of concerns, e.g., ["acne", "wrinkles", "dryness"]
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS on profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can view their own profile
CREATE POLICY "Users can view their own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

-- RLS Policy: Users can update their own profile
CREATE POLICY "Users can update their own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- RLS Policy: Users can insert their own profile
CREATE POLICY "Users can insert their own profile"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Create ingredient_favorites table
CREATE TABLE IF NOT EXISTS ingredient_favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  ingredient_name TEXT NOT NULL REFERENCES ingredients_master(name) ON DELETE CASCADE,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, ingredient_name)
);

-- Enable RLS on ingredient_favorites
ALTER TABLE ingredient_favorites ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can view their own favorites
CREATE POLICY "Users can view their own favorites"
  ON ingredient_favorites FOR SELECT
  USING (auth.uid() = user_id);

-- RLS Policy: Users can insert their own favorites
CREATE POLICY "Users can insert their own favorites"
  ON ingredient_favorites FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- RLS Policy: Users can delete their own favorites
CREATE POLICY "Users can delete their own favorites"
  ON ingredient_favorites FOR DELETE
  USING (auth.uid() = user_id);

-- Create ingredient_history table for tracking viewed/searched ingredients
CREATE TABLE IF NOT EXISTS ingredient_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  ingredient_name TEXT NOT NULL,
  action TEXT NOT NULL, -- e.g., "viewed", "searched"
  viewed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS on ingredient_history
ALTER TABLE ingredient_history ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can view their own history
CREATE POLICY "Users can view their own history"
  ON ingredient_history FOR SELECT
  USING (auth.uid() = user_id);

-- RLS Policy: Users can insert their own history
CREATE POLICY "Users can insert their own history"
  ON ingredient_history FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Create a trigger to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at
BEFORE UPDATE ON profiles
FOR EACH ROW
EXECUTE FUNCTION update_profiles_updated_at();

-- Create function to handle new user signup (auto-create profile)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, username, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'username', NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger the function every time a user is created
CREATE OR REPLACE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();
