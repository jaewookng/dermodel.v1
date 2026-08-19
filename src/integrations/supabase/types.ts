export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type SkinType =
  | 'dry'
  | 'oily'
  | 'combination'
  | 'normal'
  | 'sensitive';

export type SkinConcern =
  | 'acne'
  | 'aging'
  | 'hyperpigmentation'
  | 'redness'
  | 'dehydration'
  | 'sensitivity'
  | 'pores'
  | 'dullness'
  | 'texture'
  | 'oiliness';

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string
          username: string | null
          avatar_url: string | null
          bio: string | null
          skin_type: SkinType[] | null
          skin_concerns: SkinConcern[] | null
          favorites_public: boolean
          features_seen: string[]
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email: string
          username?: string | null
          avatar_url?: string | null
          bio?: string | null
          skin_type?: SkinType[] | null
          skin_concerns?: SkinConcern[] | null
          favorites_public?: boolean
          features_seen?: string[]
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string
          username?: string | null
          avatar_url?: string | null
          bio?: string | null
          skin_type?: SkinType[] | null
          skin_concerns?: SkinConcern[] | null
          favorites_public?: boolean
          features_seen?: string[]
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      cabinet_items: {
        Row: {
          id: string
          user_id: string
          product_id: string
          opened_on: string
          frequency: string
          routine: string
          size_ml: number | null
          dose_ml: number | null
          status: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          product_id: string
          opened_on?: string
          frequency?: string
          routine?: string
          size_ml?: number | null
          dose_ml?: number | null
          status?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          product_id?: string
          opened_on?: string
          frequency?: string
          routine?: string
          size_ml?: number | null
          dose_ml?: number | null
          status?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      product_favorites: {
        Row: {
          id: string
          user_id: string
          product_id: string
          notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          product_id: string
          notes?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          product_id?: string
          notes?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_favorites_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_favorites_product_id_fkey"
            columns: ["product_id"]
            referencedRelation: "sss_products"
            referencedColumns: ["product_id"]
          }
        ]
      }
      product_submissions: {
        Row: {
          id: string
          product_url: string
          product_name: string | null
          user_id: string | null
          status: string
          created_at: string
        }
        Insert: {
          id?: string
          product_url: string
          product_name?: string | null
          user_id?: string | null
          status?: string
          created_at?: string
        }
        Update: {
          id?: string
          product_url?: string
          product_name?: string | null
          user_id?: string | null
          status?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_submissions_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      papers: {
        Row: {
          id: string
          doi: string | null
          arxiv_id: string | null
          url: string | null
          title: string | null
          authors: string | null
          published_at: string | null
          journal: string | null
          volume: string | null
          issue: string | null
          pages: string | null
          storage_path: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          doi?: string | null
          arxiv_id?: string | null
          url?: string | null
          title?: string | null
          authors?: string | null
          published_at?: string | null
          journal?: string | null
          volume?: string | null
          issue?: string | null
          pages?: string | null
          storage_path?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          doi?: string | null
          arxiv_id?: string | null
          url?: string | null
          title?: string | null
          authors?: string | null
          published_at?: string | null
          journal?: string | null
          volume?: string | null
          issue?: string | null
          pages?: string | null
          storage_path?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      sss_ingredients: {
        Row: {
          ingredient_id: string
          ingredient_name: string | null
          product_count: number | null
          avg_position: number | null
        }
        Insert: {
          ingredient_id: string
          ingredient_name?: string | null
          product_count?: number | null
          avg_position?: number | null
        }
        Update: {
          ingredient_id?: string
          ingredient_name?: string | null
          product_count?: number | null
          avg_position?: number | null
        }
        Relationships: []
      }
      sss_products: {
        Row: {
          product_id: string
          product_name: string
          ingredient_count: number | null
          image_url: string | null
          image_source_url: string | null
          image_attribution: string | null
        }
        Insert: {
          product_id: string
          product_name: string
          ingredient_count?: number | null
          image_url?: string | null
          image_source_url?: string | null
          image_attribution?: string | null
        }
        Update: {
          product_id?: string
          product_name?: string
          ingredient_count?: number | null
          image_url?: string | null
          image_source_url?: string | null
          image_attribution?: string | null
        }
        Relationships: []
      }
      sss_product_ingredients_join: {
        Row: {
          product_id: string
          ingredient_id: string
          position: number | null
        }
        Insert: {
          product_id: string
          ingredient_id: string
          position?: number | null
        }
        Update: {
          product_id?: string
          ingredient_id?: string
          position?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_product_id"
            columns: ["product_id"]
            referencedRelation: "sss_products"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "fk_ingredient_id"
            columns: ["ingredient_id"]
            referencedRelation: "sss_ingredients"
            referencedColumns: ["ingredient_id"]
          }
        ]
      }
    }
    Views: {
      my_chat_entitlement: {
        Row: {
          user_id: string | null
          plan: string | null
          display_name: string | null
          metering_mode: string | null
          conversation_allowance_scope: string | null
          lifetime_conversations: number | null
          conversations_used_lifetime: number | null
          conversations_remaining_lifetime: number | null
          bonus_conversations: number | null
          monthly_conversations: number | null
          conversations_used_this_month: number | null
          conversations_remaining_this_month: number | null
          conversation_turn_cap: number | null
          monthly_credits: number | null
          credit_allowance_usd: number | null
          credits_used_this_month: number | null
          bonus_credits: number | null
          credits_remaining_this_month: number | null
          credit_usd_remaining_this_month: number | null
          allow_deep_dive: boolean | null
          includes_cabinet_memory: boolean | null
          includes_checkin_emails: boolean | null
          includes_surveys: boolean | null
          includes_referrals: boolean | null
          region_policy: string | null
          region_country: string | null
          region_country_source: string | null
          sell_premium: boolean | null
          checkin_emails_effective: boolean | null
          checkin_email_consent_required: boolean | null
          checkin_email_consent_action: string | null
          checkin_email_consent_at: string | null
          upgrade_prompt: string | null
          subscription_status: string | null
          current_period_end: string | null
          cancel_at_period_end: boolean | null
        }
        Relationships: []
      }
      my_cabinet: {
        Row: {
          id: string | null
          product_id: string | null
          product_name: string | null
          image_url: string | null
          opened_on: string | null
          frequency: string | null
          routine: string | null
          size_ml: number | null
          dose_ml: number | null
          status: string | null
          days_supply: number | null
          estimated_empty_on: string | null
        }
        Relationships: []
      }
      sss_ingredients_ranked: {
        Row: {
          ingredient_id: string | null
          ingredient_name: string | null
          product_count: number | null
          avg_position: number | null
          like_count: number | null
        }
        Relationships: []
      }
      sss_products_ranked: {
        Row: {
          product_id: string | null
          product_name: string | null
          ingredient_count: number | null
          image_url: string | null
          image_source_url: string | null
          image_attribution: string | null
          like_count: number | null
        }
        Relationships: []
      }
      public_favorites: {
        Row: {
          user_id: string | null
          username: string | null
          product_id: string | null
          product_name: string | null
          ingredient_count: number | null
          image_url: string | null
          image_source_url: string | null
          image_attribution: string | null
          created_at: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      record_email_consent: {
        Args: {
          p_action: string
          p_method: string
          p_consent_text?: string | null
          p_consent_version?: string | null
          p_channel?: string
        }
        Returns: string
      }
      set_my_declared_country: {
        Args: { p_country: string; p_source?: string }
        Returns: undefined
      }
      close_my_chat_conversation: {
        Args: { p_conversation_id: string }
        Returns: undefined
      }
      region_policy_for_country: {
        Args: { p_country: string }
        Returns: {
          country_code: string
          policy: string
          sell_premium: boolean
          marketing_default_opt_in: boolean
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DefaultSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof Database },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof Database },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
  ? Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
