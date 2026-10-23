export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      appointments: {
        Row: {
          barber_id: string | null
          client_id: string
          confirmation_code: string | null
          created_at: string
          created_by: string | null
          ends_at: string | null
          id: string
          notes: string
          service_id: string
          source: Database["public"]["Enums"]["visit_channel"]
          starts_at: string
          status: Database["public"]["Enums"]["appointment_status"]
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          barber_id?: string | null
          client_id: string
          confirmation_code?: string | null
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          id?: string
          notes?: string
          service_id: string
          source?: Database["public"]["Enums"]["visit_channel"]
          starts_at: string
          status?: Database["public"]["Enums"]["appointment_status"]
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          barber_id?: string | null
          client_id?: string
          confirmation_code?: string | null
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          id?: string
          notes?: string
          service_id?: string
          source?: Database["public"]["Enums"]["visit_channel"]
          starts_at?: string
          status?: Database["public"]["Enums"]["appointment_status"]
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_barber_id_fkey"
            columns: ["barber_id"]
            isOneToOne: false
            referencedRelation: "barbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      barber_toolkit_items: {
        Row: {
          active: boolean
          barber_id: string
          brand: string
          condition: string
          created_at: string
          id: string
          name: string
          notes: string
          serial_number: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          barber_id: string
          brand?: string
          condition?: string
          created_at?: string
          id?: string
          name: string
          notes?: string
          serial_number?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          barber_id?: string
          brand?: string
          condition?: string
          created_at?: string
          id?: string
          name?: string
          notes?: string
          serial_number?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "barber_toolkit_items_barber_id_fkey"
            columns: ["barber_id"]
            isOneToOne: false
            referencedRelation: "barbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "barber_toolkit_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      barbers: {
        Row: {
          active: boolean
          commission_product: number
          commission_service: number
          created_at: string
          id: string
          name: string
          skills: string[]
          station_id: string
          tenant_id: string | null
          title: string
        }
        Insert: {
          active?: boolean
          commission_product?: number
          commission_service?: number
          created_at?: string
          id: string
          name: string
          skills?: string[]
          station_id: string
          tenant_id?: string | null
          title: string
        }
        Update: {
          active?: boolean
          commission_product?: number
          commission_service?: number
          created_at?: string
          id?: string
          name?: string
          skills?: string[]
          station_id?: string
          tenant_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "barbers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_look_photos: {
        Row: {
          caption: string
          client_id: string
          created_at: string
          created_by: string | null
          id: string
          storage_path: string
        }
        Insert: {
          caption?: string
          client_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          storage_path: string
        }
        Update: {
          caption?: string
          client_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_look_photos_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_look_photos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      client_qr_tokens: {
        Row: {
          client_id: string
          created_at: string
          created_by: string | null
          expires_at: string
          revoked_at: string | null
          tenant_id: string
          token_hash: string
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string | null
          expires_at?: string
          revoked_at?: string | null
          tenant_id: string
          token_hash: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string
          revoked_at?: string | null
          tenant_id?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_qr_tokens_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_qr_tokens_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          consent_marketing: boolean
          created_at: string
          email: string | null
          full_name: string
          id: string
          loyalty_points: number
          phone: string
          preferred_barber_id: string | null
          technical_notes: string
          tenant_id: string | null
          tier: string
          updated_at: string
          visit_count: number
        }
        Insert: {
          consent_marketing?: boolean
          created_at?: string
          email?: string | null
          full_name: string
          id: string
          loyalty_points?: number
          phone: string
          preferred_barber_id?: string | null
          technical_notes?: string
          tenant_id?: string | null
          tier?: string
          updated_at?: string
          visit_count?: number
        }
        Update: {
          consent_marketing?: boolean
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          loyalty_points?: number
          phone?: string
          preferred_barber_id?: string | null
          technical_notes?: string
          tenant_id?: string | null
          tier?: string
          updated_at?: string
          visit_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "clients_preferred_barber_id_fkey"
            columns: ["preferred_barber_id"]
            isOneToOne: false
            referencedRelation: "barbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      commissions: {
        Row: {
          barber_id: string
          created_at: string
          id: string
          order_id: string
          payment_id: string
          product_amount: number
          service_amount: number
          total: number | null
        }
        Insert: {
          barber_id: string
          created_at?: string
          id?: string
          order_id: string
          payment_id: string
          product_amount: number
          service_amount: number
          total?: number | null
        }
        Update: {
          barber_id?: string
          created_at?: string
          id?: string
          order_id?: string
          payment_id?: string
          product_amount?: number
          service_amount?: number
          total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "commissions_barber_id_fkey"
            columns: ["barber_id"]
            isOneToOne: false
            referencedRelation: "barbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "service_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: true
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_items: {
        Row: {
          active: boolean
          category: Database["public"]["Enums"]["stock_category"]
          cost: number
          id: string
          minimum_quantity: number
          name: string
          quantity: number
          retail_price: number
          sku: string | null
          tenant_id: string | null
          unit: Database["public"]["Enums"]["stock_unit"]
          updated_at: string
        }
        Insert: {
          active?: boolean
          category: Database["public"]["Enums"]["stock_category"]
          cost?: number
          id: string
          minimum_quantity?: number
          name: string
          quantity?: number
          retail_price?: number
          sku?: string | null
          tenant_id?: string | null
          unit: Database["public"]["Enums"]["stock_unit"]
          updated_at?: string
        }
        Update: {
          active?: boolean
          category?: Database["public"]["Enums"]["stock_category"]
          cost?: number
          id?: string
          minimum_quantity?: number
          name?: string
          quantity?: number
          retail_price?: number
          sku?: string | null
          tenant_id?: string | null
          unit?: Database["public"]["Enums"]["stock_unit"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_movements: {
        Row: {
          actor_id: string | null
          created_at: string
          id: string
          inventory_item_id: string
          movement_type: string
          note: string
          order_id: string | null
          quantity_delta: number
          unit: Database["public"]["Enums"]["stock_unit"]
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          id?: string
          inventory_item_id: string
          movement_type: string
          note?: string
          order_id?: string | null
          quantity_delta: number
          unit: Database["public"]["Enums"]["stock_unit"]
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          id?: string
          inventory_item_id?: string
          movement_type?: string
          note?: string
          order_id?: string | null
          quantity_delta?: number
          unit?: Database["public"]["Enums"]["stock_unit"]
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "service_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_ledger: {
        Row: {
          client_id: string
          created_at: string
          description: string
          entry_type: Database["public"]["Enums"]["loyalty_entry_type"]
          id: string
          payment_id: string | null
          points: number
        }
        Insert: {
          client_id: string
          created_at?: string
          description?: string
          entry_type: Database["public"]["Enums"]["loyalty_entry_type"]
          id?: string
          payment_id?: string | null
          points: number
        }
        Update: {
          client_id?: string
          created_at?: string
          description?: string
          entry_type?: Database["public"]["Enums"]["loyalty_entry_type"]
          id?: string
          payment_id?: string | null
          points?: number
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_ledger_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_ledger_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_redemptions: {
        Row: {
          client_id: string
          id: string
          payment_id: string | null
          points: number
          redeemed_at: string
          redeemed_by: string | null
          reward_id: string
          tenant_id: string
        }
        Insert: {
          client_id: string
          id?: string
          payment_id?: string | null
          points: number
          redeemed_at?: string
          redeemed_by?: string | null
          reward_id: string
          tenant_id: string
        }
        Update: {
          client_id?: string
          id?: string
          payment_id?: string | null
          points?: number
          redeemed_at?: string
          redeemed_by?: string | null
          reward_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_redemptions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_redemptions_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_redemptions_reward_tenant_fk"
            columns: ["reward_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "loyalty_rewards"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "loyalty_redemptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_rewards: {
        Row: {
          active: boolean
          created_at: string
          description: string
          id: string
          name: string
          points_cost: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string
          id?: string
          name: string
          points_cost: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string
          id?: string
          name?: string
          points_cost?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_rewards_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_lines: {
        Row: {
          created_at: string
          id: string
          inventory_item_id: string
          item_name: string
          order_id: string
          quantity: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          id?: string
          inventory_item_id: string
          item_name: string
          order_id: string
          quantity: number
          unit_price: number
        }
        Update: {
          created_at?: string
          id?: string
          inventory_item_id?: string
          item_name?: string
          order_id?: string
          quantity?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_lines_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_lines_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "service_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_splits: {
        Row: {
          amount: number
          created_at: string
          id: string
          method: Database["public"]["Enums"]["payment_method"]
          payment_id: string
          reference: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          method: Database["public"]["Enums"]["payment_method"]
          payment_id: string
          reference?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          payment_id?: string
          reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_splits_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          client_id: string | null
          completed_at: string
          created_by: string | null
          id: string
          loyalty_discount: number
          method: Database["public"]["Enums"]["payment_method"]
          order_id: string
          receipt_code: string
          subtotal: number
          tax: number
          tip: number
          total: number
        }
        Insert: {
          client_id?: string | null
          completed_at?: string
          created_by?: string | null
          id?: string
          loyalty_discount?: number
          method: Database["public"]["Enums"]["payment_method"]
          order_id: string
          receipt_code?: string
          subtotal: number
          tax?: number
          tip?: number
          total: number
        }
        Update: {
          client_id?: string | null
          completed_at?: string
          created_by?: string | null
          id?: string
          loyalty_discount?: number
          method?: Database["public"]["Enums"]["payment_method"]
          order_id?: string
          receipt_code?: string
          subtotal?: number
          tax?: number
          tip?: number
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "payments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "service_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active: boolean
          avatar_url: string | null
          barber_id: string | null
          client_id: string | null
          created_at: string
          email: string
          full_name: string
          id: string
          phone: string | null
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          avatar_url?: string | null
          barber_id?: string | null
          client_id?: string | null
          created_at?: string
          email: string
          full_name: string
          id: string
          phone?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          avatar_url?: string | null
          barber_id?: string | null
          client_id?: string | null
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          phone?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      queue_visits: {
        Row: {
          appointment_id: string | null
          barber_id: string | null
          called_at: string | null
          channel: Database["public"]["Enums"]["visit_channel"]
          checked_in_at: string
          client_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          guest_name: string
          guest_phone: string
          id: string
          queue_number: number
          service_id: string
          started_at: string | null
          station_id: string | null
          status: Database["public"]["Enums"]["queue_status"]
          tenant_id: string | null
        }
        Insert: {
          appointment_id?: string | null
          barber_id?: string | null
          called_at?: string | null
          channel: Database["public"]["Enums"]["visit_channel"]
          checked_in_at?: string
          client_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          guest_name: string
          guest_phone?: string
          id: string
          queue_number?: never
          service_id: string
          started_at?: string | null
          station_id?: string | null
          status?: Database["public"]["Enums"]["queue_status"]
          tenant_id?: string | null
        }
        Update: {
          appointment_id?: string | null
          barber_id?: string | null
          called_at?: string | null
          channel?: Database["public"]["Enums"]["visit_channel"]
          checked_in_at?: string
          client_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          guest_name?: string
          guest_phone?: string
          id?: string
          queue_number?: never
          service_id?: string
          started_at?: string | null
          station_id?: string | null
          status?: Database["public"]["Enums"]["queue_status"]
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "queue_visits_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: true
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "queue_visits_barber_id_fkey"
            columns: ["barber_id"]
            isOneToOne: false
            referencedRelation: "barbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "queue_visits_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "queue_visits_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "queue_visits_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "queue_visits_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      restock_requests: {
        Row: {
          barber_id: string | null
          created_at: string
          fulfilled_at: string | null
          fulfilled_by: string | null
          id: string
          inventory_item_id: string
          quantity: number
          requested_by: string | null
          station_id: string
          status: Database["public"]["Enums"]["restock_status"]
          unit: Database["public"]["Enums"]["stock_unit"]
          urgency: string
        }
        Insert: {
          barber_id?: string | null
          created_at?: string
          fulfilled_at?: string | null
          fulfilled_by?: string | null
          id?: string
          inventory_item_id: string
          quantity: number
          requested_by?: string | null
          station_id: string
          status?: Database["public"]["Enums"]["restock_status"]
          unit: Database["public"]["Enums"]["stock_unit"]
          urgency?: string
        }
        Update: {
          barber_id?: string | null
          created_at?: string
          fulfilled_at?: string | null
          fulfilled_by?: string | null
          id?: string
          inventory_item_id?: string
          quantity?: number
          requested_by?: string | null
          station_id?: string
          status?: Database["public"]["Enums"]["restock_status"]
          unit?: Database["public"]["Enums"]["stock_unit"]
          urgency?: string
        }
        Relationships: [
          {
            foreignKeyName: "restock_requests_barber_id_fkey"
            columns: ["barber_id"]
            isOneToOne: false
            referencedRelation: "barbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restock_requests_fulfilled_by_fkey"
            columns: ["fulfilled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restock_requests_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restock_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      saas_admins: {
        Row: {
          created_at: string
          id: string
          profile_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          profile_id: string
        }
        Update: {
          created_at?: string
          id?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saas_admins_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      saas_subscriptions: {
        Row: {
          created_at: string
          current_period_end: string
          current_period_start: string
          id: string
          max_barbers: number
          plan: Database["public"]["Enums"]["saas_plan_tier"]
          price_monthly: number
          status: Database["public"]["Enums"]["subscription_status"]
          tenant_id: string
        }
        Insert: {
          created_at?: string
          current_period_end?: string
          current_period_start?: string
          id?: string
          max_barbers?: number
          plan?: Database["public"]["Enums"]["saas_plan_tier"]
          price_monthly?: number
          status?: Database["public"]["Enums"]["subscription_status"]
          tenant_id: string
        }
        Update: {
          created_at?: string
          current_period_end?: string
          current_period_start?: string
          id?: string
          max_barbers?: number
          plan?: Database["public"]["Enums"]["saas_plan_tier"]
          price_monthly?: number
          status?: Database["public"]["Enums"]["subscription_status"]
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saas_subscriptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      service_inventory_usage: {
        Row: {
          inventory_item_id: string
          quantity: number
          service_id: string
          unit: Database["public"]["Enums"]["stock_unit"]
        }
        Insert: {
          inventory_item_id: string
          quantity: number
          service_id: string
          unit: Database["public"]["Enums"]["stock_unit"]
        }
        Update: {
          inventory_item_id?: string
          quantity?: number
          service_id?: string
          unit?: Database["public"]["Enums"]["stock_unit"]
        }
        Relationships: [
          {
            foreignKeyName: "service_inventory_usage_item_fk"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_inventory_usage_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      service_orders: {
        Row: {
          appointment_id: string | null
          barber_id: string
          client_id: string | null
          created_at: string
          created_by: string | null
          ended_at: string | null
          guest_name: string
          guest_phone: string
          id: string
          loyalty_discount: number
          loyalty_reward_id: string | null
          paid_at: string | null
          queue_visit_id: string | null
          service_id: string
          service_price: number
          started_at: string
          station_id: string
          status: Database["public"]["Enums"]["order_status"]
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          appointment_id?: string | null
          barber_id: string
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          ended_at?: string | null
          guest_name: string
          guest_phone?: string
          id: string
          loyalty_discount?: number
          loyalty_reward_id?: string | null
          paid_at?: string | null
          queue_visit_id?: string | null
          service_id: string
          service_price: number
          started_at?: string
          station_id: string
          status?: Database["public"]["Enums"]["order_status"]
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          appointment_id?: string | null
          barber_id?: string
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          ended_at?: string | null
          guest_name?: string
          guest_phone?: string
          id?: string
          loyalty_discount?: number
          loyalty_reward_id?: string | null
          paid_at?: string | null
          queue_visit_id?: string | null
          service_id?: string
          service_price?: number
          started_at?: string
          station_id?: string
          status?: Database["public"]["Enums"]["order_status"]
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_orders_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_orders_barber_id_fkey"
            columns: ["barber_id"]
            isOneToOne: false
            referencedRelation: "barbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_orders_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_orders_loyalty_reward_tenant_fk"
            columns: ["loyalty_reward_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "loyalty_rewards"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "service_orders_queue_visit_id_fkey"
            columns: ["queue_visit_id"]
            isOneToOne: false
            referencedRelation: "queue_visits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_orders_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          active: boolean
          created_at: string
          description: string
          duration_minutes: number
          id: string
          name: string
          price: number
          tenant_id: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string
          duration_minutes: number
          id: string
          name: string
          price: number
          tenant_id?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string
          duration_minutes?: number
          id?: string
          name?: string
          price?: number
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "services_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_shifts: {
        Row: {
          checked_in_at: string | null
          checked_out_at: string | null
          ends_at: string
          id: string
          notes: string
          profile_id: string
          starts_at: string
        }
        Insert: {
          checked_in_at?: string | null
          checked_out_at?: string | null
          ends_at: string
          id?: string
          notes?: string
          profile_id: string
          starts_at: string
        }
        Update: {
          checked_in_at?: string | null
          checked_out_at?: string | null
          ends_at?: string
          id?: string
          notes?: string
          profile_id?: string
          starts_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_shifts_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_plans: {
        Row: {
          active: boolean
          capabilities: string[]
          code: string
          monthly_price: number
          name: string
        }
        Insert: {
          active?: boolean
          capabilities?: string[]
          code: string
          monthly_price: number
          name: string
        }
        Update: {
          active?: boolean
          capabilities?: string[]
          code?: string
          monthly_price?: number
          name?: string
        }
        Relationships: []
      }
      tenants: {
        Row: {
          active: boolean
          address: string
          created_at: string
          email: string
          id: string
          name: string
          phone: string
          receipt_footer: string
          slug: string
          tax_rate: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          address?: string
          created_at?: string
          email: string
          id?: string
          name: string
          phone?: string
          receipt_footer?: string
          slug: string
          tax_rate?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          address?: string
          created_at?: string
          email?: string
          id?: string
          name?: string
          phone?: string
          receipt_footer?: string
          slug?: string
          tax_rate?: number
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      adjust_client_loyalty_points: {
        Args: { p_client_id: string; p_points: number; p_reason: string }
        Returns: number
      }
      adjust_inventory_stock: {
        Args: {
          p_delta: number
          p_item_id: string
          p_movement_type: string
          p_note?: string
        }
        Returns: number
      }
      assign_queue_visit_barber: {
        Args: { p_barber_id: string; p_visit_id: string }
        Returns: undefined
      }
      attach_checkout_client: {
        Args: { p_client_id: string; p_order_id: string }
        Returns: undefined
      }
      cancel_appointment: {
        Args: { p_appointment_id: string }
        Returns: undefined
      }
      check_in_appointment: {
        Args: { p_appointment_id: string }
        Returns: string
      }
      client_qr_book_appointment: {
        Args: {
          p_barber_id: string
          p_notes?: string
          p_service_id: string
          p_starts_at: string
          p_token: string
        }
        Returns: Json
      }
      client_qr_cancel_appointment: {
        Args: { p_appointment_id: string; p_token: string }
        Returns: boolean
      }
      client_qr_check_in: {
        Args: { p_barber_id: string; p_service_id: string; p_token: string }
        Returns: Json
      }
      client_qr_list_appointments: { Args: { p_token: string }; Returns: Json }
      complete_checkout: {
        Args: {
          p_actor?: string
          p_method: Database["public"]["Enums"]["payment_method"]
          p_order_id: string
          p_splits?: Json
          p_subtotal: number
          p_tax: number
          p_tip: number
          p_total: number
        }
        Returns: string
      }
      complete_checkout_with_loyalty_reward: {
        Args: {
          p_method: Database["public"]["Enums"]["payment_method"]
          p_order_id: string
          p_reward_id: string
          p_splits: Json
          p_subtotal: number
          p_tax: number
          p_tip: number
          p_total: number
        }
        Returns: Json
      }
      create_appointment: {
        Args: {
          p_barber_id: string | null
          p_client_id: string
          p_notes?: string
          p_service_id: string
          p_starts_at: string
        }
        Returns: string
      }
      create_client_with_qr: {
        Args: { p_email?: string; p_full_name: string; p_phone: string }
        Returns: Json
      }
      create_inventory_item: {
        Args: {
          p_category: Database["public"]["Enums"]["stock_category"]
          p_cost?: number
          p_minimum?: number
          p_name: string
          p_retail_price?: number
          p_sku?: string
          p_unit: Database["public"]["Enums"]["stock_unit"]
        }
        Returns: string
      }
      create_restock_request: {
        Args: { p_item_id: string; p_quantity: number; p_urgency?: string }
        Returns: string
      }
      create_staff_shift: {
        Args: {
          p_ends_at: string
          p_notes?: string
          p_profile_id: string
          p_starts_at: string
        }
        Returns: string
      }
      create_walk_in: {
        Args: {
          p_barber_id?: string
          p_guest_name: string
          p_guest_phone: string
          p_service_id: string
        }
        Returns: string
      }
      finish_service: {
        Args: { p_actor?: string; p_order_id: string }
        Returns: undefined
      }
      fulfill_restock_request: {
        Args: { p_request_id: string }
        Returns: string
      }
      issue_client_qr: { Args: { p_client_id: string }; Returns: string }
      mark_appointment_no_show: {
        Args: { p_appointment_id: string }
        Returns: undefined
      }
      read_client_loyalty: { Args: { p_token: string }; Returns: Json }
      revoke_client_qr: { Args: { p_client_id: string }; Returns: undefined }
      set_checkout_product_quantity: {
        Args: { p_item_id: string; p_order_id: string; p_quantity: number }
        Returns: undefined
      }
      set_staff_shift_attendance: {
        Args: { p_action: string; p_shift_id: string }
        Returns: undefined
      }
      transition_queue_visit: {
        Args: {
          p_status: Database["public"]["Enums"]["queue_status"]
          p_visit_id: string
        }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "SUPER_ADMIN" | "RECEPCION" | "BARBER" | "CLIENT"
      appointment_status:
        | "confirmed"
        | "waiting"
        | "in-chair"
        | "complete"
        | "cancelled"
        | "no-show"
      loyalty_entry_type: "earned" | "redeemed" | "adjustment"
      order_status: "in-service" | "ready-for-checkout" | "paid" | "cancelled"
      payment_method: "card" | "cash" | "mobile-transfer" | "loyalty" | "split"
      queue_status: "waiting" | "called" | "in-chair" | "complete" | "cancelled"
      restock_status: "open" | "fulfilled" | "cancelled"
      saas_plan_tier: "BASIC" | "PRO" | "ENTERPRISE"
      stock_category:
        | "Retail"
        | "Backbar"
        | "Desechables"
        | "Textiles"
        | "Herramientas"
      stock_unit: "unit" | "ml" | "g" | "pack"
      subscription_status: "trialing" | "active" | "past_due" | "canceled"
      tenant_status:
        | "trialing"
        | "active"
        | "past_due"
        | "suspended"
        | "cancelled"
      visit_channel: "walk-in" | "booking" | "qr"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["SUPER_ADMIN", "RECEPCION", "BARBER", "CLIENT"],
      appointment_status: [
        "confirmed",
        "waiting",
        "in-chair",
        "complete",
        "cancelled",
        "no-show",
      ],
      loyalty_entry_type: ["earned", "redeemed", "adjustment"],
      order_status: ["in-service", "ready-for-checkout", "paid", "cancelled"],
      payment_method: ["card", "cash", "mobile-transfer", "loyalty", "split"],
      queue_status: ["waiting", "called", "in-chair", "complete", "cancelled"],
      restock_status: ["open", "fulfilled", "cancelled"],
      saas_plan_tier: ["BASIC", "PRO", "ENTERPRISE"],
      stock_category: [
        "Retail",
        "Backbar",
        "Desechables",
        "Textiles",
        "Herramientas",
      ],
      stock_unit: ["unit", "ml", "g", "pack"],
      subscription_status: ["trialing", "active", "past_due", "canceled"],
      tenant_status: [
        "trialing",
        "active",
        "past_due",
        "suspended",
        "cancelled",
      ],
      visit_channel: ["walk-in", "booking", "qr"],
    },
  },
} as const

