export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      app_settings: {
        Row: {
          created_at: string
          id: string
          key: string
          updated_at: string
          user_id: string
          value: string
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          updated_at?: string
          user_id: string
          value?: string
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          updated_at?: string
          user_id?: string
          value?: string
        }
        Relationships: []
      }
      calc_rows: {
        Row: {
          aposta: number
          created_at: string
          deposito: number
          id: string
          ordem: number
          rollover: number
          saque: number
          slots: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          aposta?: number
          created_at?: string
          deposito?: number
          id?: string
          ordem?: number
          rollover?: number
          saque?: number
          slots?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          aposta?: number
          created_at?: string
          deposito?: number
          id?: string
          ordem?: number
          rollover?: number
          saque?: number
          slots?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      chaves_pix: {
        Row: {
          banco: string
          chave: string
          created_at: string
          id: string
          ordem: number
          tipo_chave: string
          titular: string
          updated_at: string
          user_id: string
        }
        Insert: {
          banco?: string
          chave: string
          created_at?: string
          id?: string
          ordem?: number
          tipo_chave?: string
          titular?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          banco?: string
          chave?: string
          created_at?: string
          id?: string
          ordem?: number
          tipo_chave?: string
          titular?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      dkdash_credentials: {
        Row: {
          cached_token: string | null
          cached_token_exp: number | null
          cached_token_info: Json | null
          created_at: string
          dk_username: string
          filial_id: string
          id: string
          last_login_at: string | null
          password_encrypted: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cached_token?: string | null
          cached_token_exp?: number | null
          cached_token_info?: Json | null
          created_at?: string
          dk_username: string
          filial_id?: string
          id?: string
          last_login_at?: string | null
          password_encrypted: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cached_token?: string | null
          cached_token_exp?: number | null
          cached_token_info?: Json | null
          created_at?: string
          dk_username?: string
          filial_id?: string
          id?: string
          last_login_at?: string | null
          password_encrypted?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      dkdash_ranking: {
        Row: {
          nickname: string
          total_geral: number
          total_hoje: number
          total_mes: number
          updated_at: string
          user_id: string | null
        }
        Insert: {
          nickname: string
          total_geral?: number
          total_hoje?: number
          total_mes?: number
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          nickname?: string
          total_geral?: number
          total_hoje?: number
          total_mes?: number
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      dkdash_turno_alert_state: {
        Row: {
          categoria: string
          created_at: string
          filial_id: string
          id: string
          last_first_username: string | null
          last_notified_at: string | null
          last_signature: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          categoria?: string
          created_at?: string
          filial_id?: string
          id?: string
          last_first_username?: string | null
          last_notified_at?: string | null
          last_signature?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          categoria?: string
          created_at?: string
          filial_id?: string
          id?: string
          last_first_username?: string | null
          last_notified_at?: string | null
          last_signature?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      dkdash_turno_rotations: {
        Row: {
          categoria: string
          created_at: string
          day: string
          filial_id: string
          id: string
          rotated_username: string
          user_id: string
        }
        Insert: {
          categoria?: string
          created_at?: string
          day?: string
          filial_id: string
          id?: string
          rotated_username: string
          user_id: string
        }
        Update: {
          categoria?: string
          created_at?: string
          day?: string
          filial_id?: string
          id?: string
          rotated_username?: string
          user_id?: string
        }
        Relationships: []
      }
      extension_licenses: {
        Row: {
          activated_at: string | null
          active: boolean
          created_at: string
          device_id: string | null
          device_info: string
          id: string
          label: string
          last_seen_at: string | null
          serial: string
          updated_at: string
          user_id: string
        }
        Insert: {
          activated_at?: string | null
          active?: boolean
          created_at?: string
          device_id?: string | null
          device_info?: string
          id?: string
          label?: string
          last_seen_at?: string | null
          serial: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          activated_at?: string | null
          active?: boolean
          created_at?: string
          device_id?: string | null
          device_info?: string
          id?: string
          label?: string
          last_seen_at?: string | null
          serial?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      meta_events: {
        Row: {
          balance: number | null
          balance_raw: string | null
          created_at: string
          id: string
          raw: Json | null
          source_tab_id: string | null
          source_token: string | null
          steps: number | null
          target: number | null
          title: string | null
          url: string | null
          user_id: string
        }
        Insert: {
          balance?: number | null
          balance_raw?: string | null
          created_at?: string
          id?: string
          raw?: Json | null
          source_tab_id?: string | null
          source_token?: string | null
          steps?: number | null
          target?: number | null
          title?: string | null
          url?: string | null
          user_id: string
        }
        Update: {
          balance?: number | null
          balance_raw?: string | null
          created_at?: string
          id?: string
          raw?: Json | null
          source_tab_id?: string | null
          source_token?: string | null
          steps?: number | null
          target?: number | null
          title?: string | null
          url?: string | null
          user_id?: string
        }
        Relationships: []
      }
      pix_bank_priorities: {
        Row: {
          banco: string
          created_at: string
          id: string
          nivel: number
          updated_at: string
          user_id: string
        }
        Insert: {
          banco: string
          created_at?: string
          id?: string
          nivel?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          banco?: string
          created_at?: string
          id?: string
          nivel?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      platform_mappings: {
        Row: {
          created_at: string
          id: string
          platform_name: string
          updated_at: string
          url_norm: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          platform_name: string
          updated_at?: string
          url_norm: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          platform_name?: string
          updated_at?: string
          url_norm?: string
          user_id?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      slot_mapping_codes: {
        Row: {
          codes: Json
          created_at: string
          id: string
          slot_name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          codes?: Json
          created_at?: string
          id?: string
          slot_name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          codes?: Json
          created_at?: string
          id?: string
          slot_name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      slots_catalog: {
        Row: {
          ativo: boolean
          bet_default: number
          created_at: string
          id: string
          nome: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ativo?: boolean
          bet_default?: number
          created_at?: string
          id?: string
          nome: string
          updated_at?: string
          user_id: string
        }
        Update: {
          ativo?: boolean
          bet_default?: number
          created_at?: string
          id?: string
          nome?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      wa_keywords: {
        Row: {
          created_at: string
          id: string
          palavra: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          palavra: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          palavra?: string
          user_id?: string
        }
        Relationships: []
      }
      wa_messages: {
        Row: {
          autor: string
          created_at: string
          grupo: string
          id: string
          matched: string[]
          mensagem: string
          source_author_id: string
          source_chat_id: string
          source_msg_id: string
          telefone: string
          user_id: string
        }
        Insert: {
          autor?: string
          created_at?: string
          grupo?: string
          id?: string
          matched?: string[]
          mensagem: string
          source_author_id?: string
          source_chat_id?: string
          source_msg_id?: string
          telefone?: string
          user_id: string
        }
        Update: {
          autor?: string
          created_at?: string
          grupo?: string
          id?: string
          matched?: string[]
          mensagem?: string
          source_author_id?: string
          source_chat_id?: string
          source_msg_id?: string
          telefone?: string
          user_id?: string
        }
        Relationships: []
      }
      wa_outbox: {
        Row: {
          chat_id: string
          created_at: string
          error: string
          id: string
          image_url: string
          quoted_msg_id: string
          sent_at: string | null
          status: string
          text: string
          user_id: string
        }
        Insert: {
          chat_id: string
          created_at?: string
          error?: string
          id?: string
          image_url?: string
          quoted_msg_id?: string
          sent_at?: string | null
          status?: string
          text: string
          user_id: string
        }
        Update: {
          chat_id?: string
          created_at?: string
          error?: string
          id?: string
          image_url?: string
          quoted_msg_id?: string
          sent_at?: string | null
          status?: string
          text?: string
          user_id?: string
        }
        Relationships: []
      }
      wa_tasks: {
        Row: {
          autor: string
          completed_at: string | null
          created_at: string
          grupo: string
          id: string
          image_urls: string[]
          link: string
          matched: string[]
          mensagem: string
          nome_tarefa: string
          operation_data: Json
          pix_keys: Json
          source_author_id: string
          source_chat_id: string
          source_msg_id: string
          status: string
          telefone: string
          user_id: string
        }
        Insert: {
          autor?: string
          completed_at?: string | null
          created_at?: string
          grupo?: string
          id?: string
          image_urls?: string[]
          link?: string
          matched?: string[]
          mensagem: string
          nome_tarefa?: string
          operation_data?: Json
          pix_keys?: Json
          source_author_id?: string
          source_chat_id?: string
          source_msg_id?: string
          status?: string
          telefone?: string
          user_id: string
        }
        Update: {
          autor?: string
          completed_at?: string | null
          created_at?: string
          grupo?: string
          id?: string
          image_urls?: string[]
          link?: string
          matched?: string[]
          mensagem?: string
          nome_tarefa?: string
          operation_data?: Json
          pix_keys?: Json
          source_author_id?: string
          source_chat_id?: string
          source_msg_id?: string
          status?: string
          telefone?: string
          user_id?: string
        }
        Relationships: []
      }
      wa_tokens: {
        Row: {
          created_at: string
          id: string
          label: string
          token: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          label?: string
          token: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          token?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
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
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
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
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
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
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
